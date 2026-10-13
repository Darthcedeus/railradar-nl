import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { validateAlert } from '../server/alerts.mjs';
test('real Web Push library produces encrypted payload and VAPID authorization without sending',()=>{
 const recipient=createECDH('prime256v1');recipient.generateKeys();
 const keys=webpush.generateVAPIDKeys();
 const subscription={endpoint:'https://web.push.apple.com/test-only-not-sent',keys:{p256dh:recipient.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 const d=validateAlert({subscription,rule:{lat:52,lng:5,radius:3000,kind:'all',label:'Test'}});
 const request=webpush.generateRequestDetails(d.subscription,JSON.stringify({title:'Private test'}),{vapidDetails:{subject:'https://railradar.example.com',...keys},TTL:60,urgency:'high'});
 assert.equal(request.method,'POST');assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.ok(request.headers.Authorization);assert.equal(request.headers.TTL,60);assert.ok(!request.body.toString().includes('Private test'));
});
