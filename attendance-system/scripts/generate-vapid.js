const webpush = require('web-push');
const k = webpush.generateVAPIDKeys();
console.log('Add these to your environment (Render dashboard or .env):\n');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
