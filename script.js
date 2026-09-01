const fs = require('fs');
let code = fs.readFileSync('src/services/push.service.ts', 'utf8');

// Update single send error logging
code = code.replace(
  /} catch \(error\) {\r?\n\s*console.error\('Error sending push notification via FCM:', error\);\r?\n\s*}/,
  } catch (error: any) {
    console.error('Error sending push notification via FCM:', error);
    console.error('[FCM FAILURE CATCH]', {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      name: error?.name
    });
  }
);

// Update batch send error logging
code = code.replace(
  /const response = await admin\.messaging\(\)\.sendEach\(messages\);\r?\n\s*console\.log\(\Successfully sent \$\{response\.successCount\} messages; failed \$\{response\.failureCount\} messages\.\\);\r?\n\s*\} catch \(error\) {/,
  const response = await admin.messaging().sendEach(messages);
      console.log(\Successfully sent \ messages; failed \ messages.\);
      
      if (response.failureCount > 0) {
        response.responses.forEach((resp, index) => {
          if (!resp.success && resp.error) {
            console.error('[FCM FAILURE]', {
              code: resp.error.code,
              message: resp.error.message,
              details: resp.error.details,
              name: resp.error.name,
              index
            });
          }
        });
      }
    } catch (error: any) {
);

// Update the catch error for batch send
code = code.replace(
  /console\.error\('Error sending batch push notifications via FCM:', error\);\r?\n\s*}/,
  console.error('Error sending batch push notifications via FCM:', error);
      console.error('[FCM FAILURE CATCH]', {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        name: error?.name
      });
    }
);

fs.writeFileSync('src/services/push.service.ts', code);
