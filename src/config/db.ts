import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from '../utils/crypto.utils';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Helper to encrypt query inputs for User model
const encryptUserInputs = (args: any) => {
  if (!args) return args;

  // Encrypt phone number in where clauses
  if (args.where) {
    if (typeof args.where.phoneNumber === 'string') {
      args.where.phoneNumber = encrypt(args.where.phoneNumber);
    } else if (args.where.phoneNumber?.equals) {
      args.where.phoneNumber.equals = encrypt(args.where.phoneNumber.equals);
    } else if (args.where.phoneNumber?.in) {
      args.where.phoneNumber.in = args.where.phoneNumber.in.map((p: string) => encrypt(p));
    }
  }

  // Encrypt phone number and upiId in data clauses (create/update)
  if (args.data) {
    if (typeof args.data.phoneNumber === 'string') {
      args.data.phoneNumber = encrypt(args.data.phoneNumber);
    }
    if (typeof args.data.upiId === 'string') {
      args.data.upiId = encrypt(args.data.upiId);
    }
  }

  return args;
};

const basePrisma = new PrismaClient({ adapter, errorFormat: 'minimal' });

export const prisma = basePrisma.$extends({
  result: {
    user: {
      phoneNumber: {
        needs: { phoneNumber: true },
        compute(user) {
          return decrypt(user.phoneNumber);
        }
      },
      upiId: {
        needs: { upiId: true },
        compute(user) {
          return user.upiId ? decrypt(user.upiId) : null;
        }
      }
    }
  },
  query: {
    user: {
      async findUnique({ args, query }) {
        args = encryptUserInputs(args);
        return query(args);
      },
      async findFirst({ args, query }) {
        args = encryptUserInputs(args);
        return query(args);
      },
      async findMany({ args, query }) {
        args = encryptUserInputs(args);
        return query(args);
      },
      async create({ args, query }) {
        args = encryptUserInputs(args);
        return query(args);
      },
      async update({ args, query }) {
        args = encryptUserInputs(args);
        return query(args);
      },
      async upsert({ args, query }) {
        args = encryptUserInputs(args);
        return query(args);
      }
    }
  }
});
export type PrismaClientExtended = typeof prisma;
