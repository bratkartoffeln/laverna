import { application } from './app.mjs';
const app = await application({
  dataDirectory: process.env.LAVERNA_DATA || '/data',
  webDirectory: process.env.LAVERNA_WEB || '/app/web',
  secureCookies: process.env.LAVERNA_SECURE_COOKIES !== 'false',
  publicUrl: process.env.LAVERNA_PUBLIC_URL || 'https://flusensieb.dns.navy:10443',
  revision: process.env.LAVERNA_REVISION || 'development'
});
app.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Laverna NAS ready; initial setup key (if needed): /data/setup-token'));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => app.close().then(() => process.exit(0)));
