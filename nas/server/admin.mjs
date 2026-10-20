// Recovery/backup CLI: passwords come from stdin, never command arguments.
import { Store } from './store.mjs';
import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
const directory = process.env.LAVERNA_DATA || '/data';
const store = await Store.open(directory);
try {
  const [command, name] = process.argv.slice(2);
  if (command === 'backup') {
    const backups = join(directory, 'backups'); await mkdir(backups, {recursive:true, mode:0o700});
    const filename = join(backups, 'laverna-' + new Date().toISOString().replaceAll(':','-') + '.sqlite');
    await store.backup(filename); console.log(filename);
  } else if (command === 'create-admin' || command === 'reset-password') {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const pass = input.replace(/\r?\n$/, ''); input = '';
    if (command === 'create-admin') {
      if (store.hasUsers()) throw new Error('Initial administrator already exists. Use account management.');
      await store.createUser(name, pass, true, store.setupToken);
    } else {
      const user = store.db.prepare('SELECT id FROM users WHERE username=?').get(name?.toLowerCase());
      if (!user) throw new Error('Unknown user.'); await store.changePassword(user.id, pass);
    }
    console.log('Account updated.');
  } else throw new Error('Usage: node admin.mjs backup | create-admin USER (password on stdin) | reset-password USER (password on stdin)');
} finally { store.close(); }
