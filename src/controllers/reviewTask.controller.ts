import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest } from '../middleware/adminAuth.middleware';
import { prisma } from '../config/db';
import { storage } from '../config/firebase';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

// ==========================================
// USER CONTROLLERS
// ==========================================

/**
 * GET /api/user/review-tasks
 * Fetches all active review tasks and attaches the current user's submission state.
 */
export const getReviewTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;

    // 1. Fetch all active review tasks
    const tasks = await prisma.reviewTask.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!userId) {
      res.status(200).json({
        success: true,
        tasks: tasks.map(t => ({
          ...t,
          submissionStatus: 'AVAILABLE',
          rejectionReason: null,
          screenshotUrl: null,
          submittedAt: null
        }))
      });
      return;
    }

    // 2. Fetch current user data (including deviceId)
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { deviceId: true }
    });
    const deviceId = currentUser?.deviceId;

    // 3. Fetch user's own submissions
    const userSubmissions = await prisma.reviewSubmission.findMany({
      where: { userId }
    });
    const submissionMap = new Map(userSubmissions.map(s => [s.taskId, s]));

    // 4. Fetch device-level submissions if deviceId exists (to prevent multi-account claims on same device)
    let deviceClaimedTaskIds = new Set<string>();
    if (deviceId) {
      const deviceSubmissions = await prisma.reviewSubmission.findMany({
        where: {
          deviceId,
          userId: { not: userId },
          status: { in: ['PENDING', 'APPROVED'] }
        },
        select: { taskId: true }
      });
      deviceClaimedTaskIds = new Set(deviceSubmissions.map(s => s.taskId));
    }

    // 5. Combine task list with user status
    const enrichedTasks = tasks.map(task => {
      const userSub = submissionMap.get(task.id);
      if (userSub) {
        return {
          id: task.id,
          businessName: task.businessName,
          reviewUrl: task.reviewUrl,
          coinsReward: task.coinsReward,
          instructions: task.instructions,
          createdAt: task.createdAt,
          submissionStatus: userSub.status, // 'PENDING' | 'APPROVED' | 'REJECTED'
          rejectionReason: userSub.rejectionReason,
          screenshotUrl: userSub.screenshotUrl,
          submittedAt: userSub.submittedAt
        };
      }

      // Check if another account on the same device already claimed or submitted
      if (deviceClaimedTaskIds.has(task.id)) {
        return {
          id: task.id,
          businessName: task.businessName,
          reviewUrl: task.reviewUrl,
          coinsReward: task.coinsReward,
          instructions: task.instructions,
          createdAt: task.createdAt,
          submissionStatus: 'DEVICE_CLAIMED',
          rejectionReason: 'Already claimed on this device with another account.',
          screenshotUrl: null,
          submittedAt: null
        };
      }

      return {
        id: task.id,
        businessName: task.businessName,
        reviewUrl: task.reviewUrl,
        coinsReward: task.coinsReward,
        instructions: task.instructions,
        createdAt: task.createdAt,
        submissionStatus: 'AVAILABLE',
        rejectionReason: null,
        screenshotUrl: null,
        submittedAt: null
      };
    });

    res.status(200).json({
      success: true,
      tasks: enrichedTasks
    });
  } catch (error) {
    console.error('Error fetching review tasks for user:', error);
    res.status(500).json({ error: 'Internal server error while fetching review tasks' });
  }
};

/**
 * POST /api/user/review-tasks/submit
 * Submits a review screenshot proof for a specific review task.
 */
export const submitReviewProof = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.userId;
    const { taskId, screenshotBase64 } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: User session not found' });
      return;
    }

    if (!taskId) {
      res.status(400).json({ error: 'Task ID is required' });
      return;
    }

    if (!screenshotBase64 || typeof screenshotBase64 !== 'string') {
      res.status(400).json({ error: 'Screenshot proof image is required' });
      return;
    }

    // 1. Verify task exists and is active
    const task = await prisma.reviewTask.findUnique({
      where: { id: taskId }
    });

    if (!task || !task.isActive) {
      res.status(404).json({ error: 'Review task not found or is no longer active' });
      return;
    }

    // 2. Fetch user to check device ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deviceId: true }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // 3. Check existing submission for this user
    const existingSubmission = await prisma.reviewSubmission.findUnique({
      where: {
        userId_taskId: {
          userId,
          taskId
        }
      }
    });

    if (existingSubmission) {
      if (existingSubmission.status === 'APPROVED') {
        res.status(400).json({ error: 'You have already completed this review and received your reward.' });
        return;
      }
      if (existingSubmission.status === 'PENDING') {
        res.status(400).json({ error: 'Your proof for this task is already under review.' });
        return;
      }
      // If status === 'REJECTED', we allow user to re-upload proof and reset to PENDING!
    } else {
      // 4. Device fraud check: ensure no other account on this device submitted this task
      if (user.deviceId) {
        const deviceConflict = await prisma.reviewSubmission.findFirst({
          where: {
            taskId,
            deviceId: user.deviceId,
            userId: { not: userId },
            status: { in: ['PENDING', 'APPROVED'] }
          }
        });
        if (deviceConflict) {
          res.status(400).json({ error: 'This review task has already been claimed or submitted from this device.' });
          return;
        }
      }
    }

    // 5. Process Image & Upload
    let cleanBase64 = screenshotBase64;
    if (cleanBase64.startsWith('data:image')) {
      cleanBase64 = cleanBase64.replace(/^data:image\/\w+;base64,/, '');
    }
    const buffer = Buffer.from(cleanBase64, 'base64');

    let publicUrl = '';
    try {
      // Try Firebase Storage first
      const bucket = storage.bucket();
      const token = randomUUID();
      const fileName = `review_proofs/${userId}_${taskId}_${Date.now()}.jpg`;
      const file = bucket.file(fileName);

      await file.save(buffer, {
        metadata: {
          contentType: 'image/jpeg',
          metadata: {
            firebaseStorageDownloadTokens: token,
          }
        },
      });

      publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
    } catch (storageErr) {
      console.warn('Firebase Storage upload failed, saving to local static storage:', storageErr);
      const uploadsDir = path.join(__dirname, '../../public/uploads/review_proofs');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const localFileName = `${userId}_${taskId}_${Date.now()}.jpg`;
      const localFilePath = path.join(uploadsDir, localFileName);
      fs.writeFileSync(localFilePath, buffer);

      const host = req.get('host') || 'localhost:3000';
      const protocol = req.protocol || 'http';
      publicUrl = `${protocol}://${host}/uploads/review_proofs/${localFileName}`;
    }

    // 6. Save or update ReviewSubmission
    let submission;
    if (existingSubmission && existingSubmission.status === 'REJECTED') {
      submission = await prisma.reviewSubmission.update({
        where: { id: existingSubmission.id },
        data: {
          screenshotUrl: publicUrl,
          status: 'PENDING',
          rejectionReason: null,
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          deviceId: user.deviceId || existingSubmission.deviceId
        }
      });
    } else {
      submission = await prisma.reviewSubmission.create({
        data: {
          userId,
          taskId,
          deviceId: user.deviceId || null,
          screenshotUrl: publicUrl,
          status: 'PENDING'
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Proof submitted successfully! It is now pending admin verification.',
      submission
    });
  } catch (error) {
    console.error('Error submitting review proof:', error);
    res.status(500).json({ error: 'Internal server error while submitting review proof' });
  }
};


// ==========================================
// ADMIN CONTROLLERS
// ==========================================

/**
 * GET /api/admin/review-tasks
 * Admin list of all review tasks with submission statistics.
 */
export const getAdminReviewTasks = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const tasks = await prisma.reviewTask.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { submissions: true }
        }
      }
    });

    // Group submission counts by status for each task
    const countsGrouped = await prisma.reviewSubmission.groupBy({
      by: ['taskId', 'status'],
      _count: true
    });

    const enriched = tasks.map(t => {
      const pending = countsGrouped.find(c => c.taskId === t.id && c.status === 'PENDING')?._count || 0;
      const approved = countsGrouped.find(c => c.taskId === t.id && c.status === 'APPROVED')?._count || 0;
      const rejected = countsGrouped.find(c => c.taskId === t.id && c.status === 'REJECTED')?._count || 0;

      return {
        ...t,
        stats: {
          total: t._count.submissions,
          pending,
          approved,
          rejected
        }
      };
    });

    res.status(200).json({
      success: true,
      tasks: enriched
    });
  } catch (error) {
    console.error('Error fetching admin review tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/review-tasks
 * Admin create new review task.
 */
export const createAdminReviewTask = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { businessName, reviewUrl, coinsReward, instructions } = req.body;

    if (!businessName || typeof businessName !== 'string') {
      res.status(400).json({ error: 'Business name is required' });
      return;
    }

    if (!reviewUrl || typeof reviewUrl !== 'string') {
      res.status(400).json({ error: 'Review URL is required' });
      return;
    }

    const reward = typeof coinsReward === 'number' ? coinsReward : parseInt(coinsReward) || 50;
    if (reward <= 0) {
      res.status(400).json({ error: 'Coins reward must be greater than 0' });
      return;
    }

    const newTask = await prisma.reviewTask.create({
      data: {
        businessName: businessName.trim(),
        reviewUrl: reviewUrl.trim(),
        coinsReward: reward,
        instructions: instructions ? instructions.trim() : null,
        isActive: true
      }
    });

    res.status(200).json({
      success: true,
      message: 'Review task created successfully',
      task: newTask
    });
  } catch (error) {
    console.error('Error creating review task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PUT /api/admin/review-tasks/:id
 * Admin update review task.
 */
export const updateAdminReviewTask = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { businessName, reviewUrl, coinsReward, instructions, isActive } = req.body;

    if (!id) {
      res.status(400).json({ error: 'Task ID is required' });
      return;
    }

    const existing = await prisma.reviewTask.findUnique({ where: { id: id as string } });
    if (!existing) {
      res.status(404).json({ error: 'Review task not found' });
      return;
    }

    const updated = await prisma.reviewTask.update({
      where: { id: id as string },
      data: {
        businessName: businessName !== undefined ? businessName.trim() : existing.businessName,
        reviewUrl: reviewUrl !== undefined ? reviewUrl.trim() : existing.reviewUrl,
        coinsReward: coinsReward !== undefined ? (typeof coinsReward === 'number' ? coinsReward : parseInt(coinsReward) || 50) : existing.coinsReward,
        instructions: instructions !== undefined ? (instructions ? instructions.trim() : null) : existing.instructions,
        isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive
      }
    });

    res.status(200).json({
      success: true,
      message: 'Review task updated successfully',
      task: updated
    });
  } catch (error) {
    console.error('Error updating review task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * DELETE /api/admin/review-tasks/:id
 * Admin delete review task.
 */
export const deleteAdminReviewTask = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'Task ID is required' });
      return;
    }

    await prisma.reviewTask.delete({
      where: { id: id as string }
    });

    res.status(200).json({
      success: true,
      message: 'Review task deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting review task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/admin/review-submissions
 * Admin list submissions with optional status filter.
 */
export const getAdminReviewSubmissions = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { status, taskId } = req.query;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as string;
    }
    if (taskId) {
      where.taskId = taskId as string;
    }

    const submissions = await prisma.reviewSubmission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            username: true,
            deviceId: true
          }
        },
        task: {
          select: {
            id: true,
            businessName: true,
            reviewUrl: true,
            coinsReward: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      submissions
    });
  } catch (error) {
    console.error('Error fetching admin review submissions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/review-submissions/:id/approve
 * Admin approves a review submission.
 * Atomically marks APPROVED, increments user balance & totalEarned, creates Transaction & Notification.
 */
export const approveReviewSubmission = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const adminIdentifier = req.admin?.username || req.admin?.name || req.admin?.email || 'admin';

    if (!id) {
      res.status(400).json({ error: 'Submission ID is required' });
      return;
    }

    const submission = await prisma.reviewSubmission.findUnique({
      where: { id: id as string },
      include: {
        task: true,
        user: true
      }
    });

    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    if (submission.status === 'APPROVED') {
      res.status(400).json({ error: 'This submission has already been approved' });
      return;
    }

    const coinsToCredit = submission.task.coinsReward;

    // Process atomically
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update submission
      const updatedSub = await tx.reviewSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'APPROVED',
          rejectionReason: null,
          reviewedAt: new Date(),
          reviewedBy: adminIdentifier
        }
      });

      // 2. Increment user balance and totalEarned
      const updatedUser = await tx.user.update({
        where: { id: submission.userId },
        data: {
          balance: { increment: coinsToCredit },
          totalEarned: { increment: coinsToCredit }
        }
      });

      // 3. Create earning transaction
      const transactionRecord = await tx.transaction.create({
        data: {
          userId: submission.userId,
          amount: coinsToCredit,
          type: 'earning',
          status: 'success',
          description: `Google Review: ${submission.task.businessName}`
        }
      });

      // 4. Create in-app notification
      await tx.notification.create({
        data: {
          userId: submission.userId,
          title: 'Review Approved! 🎉',
          body: `Your Google review for "${submission.task.businessName}" was approved! ${coinsToCredit} coins have been added to your wallet.`,
          type: 'reward'
        }
      });

      return { updatedSub, updatedUser, transactionRecord };
    });

    res.status(200).json({
      success: true,
      message: 'Submission approved and coins credited successfully',
      coinsCredited: coinsToCredit,
      newBalance: result.updatedUser.balance
    });
  } catch (error) {
    console.error('Error approving review submission:', error);
    res.status(500).json({ error: 'Internal server error while approving submission' });
  }
};

/**
 * POST /api/admin/review-submissions/:id/reject
 * Admin rejects a review submission with a mandatory reason.
 */
export const rejectReviewSubmission = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminIdentifier = req.admin?.username || req.admin?.name || req.admin?.email || 'admin';

    if (!id) {
      res.status(400).json({ error: 'Submission ID is required' });
      return;
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const submission = await prisma.reviewSubmission.findUnique({
      where: { id: id as string },
      include: {
        task: true
      }
    });

    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    if (submission.status === 'APPROVED') {
      res.status(400).json({ error: 'Cannot reject a submission that has already been approved' });
      return;
    }

    const updatedSub = await prisma.$transaction(async (tx) => {
      const sub = await tx.reviewSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'REJECTED',
          rejectionReason: reason.trim(),
          reviewedAt: new Date(),
          reviewedBy: adminIdentifier
        }
      });

      // Send rejection notification
      await tx.notification.create({
        data: {
          userId: submission.userId,
          title: 'Review Submission Rejected',
          body: `Your submission for "${submission.task.businessName}" was rejected. Reason: ${reason.trim()}`,
          type: 'alert'
        }
      });

      return sub;
    });

    res.status(200).json({
      success: true,
      message: 'Submission rejected successfully',
      submission: updatedSub
    });
  } catch (error) {
    console.error('Error rejecting review submission:', error);
    res.status(500).json({ error: 'Internal server error while rejecting submission' });
  }
};
