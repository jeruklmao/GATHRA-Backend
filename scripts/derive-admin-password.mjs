import { randomBytes, scrypt } from 'node:crypto';

const chunks=[];
for await(const chunk of process.stdin)chunks.push(chunk);
const password=Buffer.concat(chunks).toString('utf8');
if(password.length<12||password.length>1024)process.exit(2);
const salt=randomBytes(16);
scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,digest)=>{
  if(error)throw error;
  process.stdout.write(`scrypt$32768$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`);
});
