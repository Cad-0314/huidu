const f2payService = require('../services/f2pay');

async function testverify() {
    console.log('--- Testing Verification Logic ---');

    // Data from f2pay_requests.log
    // Response: {"code":"3001","msg":"invalid customer bank account","sysTime":"20251225132752263","sign":"...","bizContent":"","success":false}

    // bizContent is empty string
    const bizContent = "";

    // Signature from log
    const signature = "oNuqKh2ertUKL6Bd/zLPPagbJOPoVSFT8yIoPnQ168D5YaDhqTVrYnV69aNaiiEXUfshlQBpV+TcjUUwqsaorDAUUs/ebN8aYlAMXIWnWPYeVGLRiIJsN7Dze3Fuh6Ec1qyHtuN7U7rqYQJqPnpNk/7HWfUVeOkyjFlGlblPN2Yweso9sEz5YhPNbyN5fE12BIKfHmefMApGn3rFXXHWJNCvtFg/dL83MbnHmAZiec2D5GhGLyj12JJZiKaFFhjaX9V/YvhOyf2MDhER8HRFJhVZsjL/nPrNIqAsgYR9i7iX5I614l829qA5FkqFHR1oLRTq8tyLq5VRanG0AIz+nA==";

    console.log('Verifying empty bizContent with provided signature...');

    const isValid = f2payService.verifyRsaSign(bizContent, signature);

    console.log('Is Signature Valid?', isValid);
}

testverify();
