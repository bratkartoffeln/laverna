'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const less = require('less');
const { zipSync } = require('fflate');

const root = path.resolve(__dirname, '..');
const staging = path.join(root, '.tmp', 'nas-build');
const output = path.join(root, 'release', 'laverna-nas');

async function run(command, args, options) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', ...options });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exited with ' + code)));
    });
}

async function build() {
    await fs.mkdir(staging, { recursive: true });
    const applicationVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    const nasVersion = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8')).version;
    const locked = JSON.parse(await fs.readFile(path.join(__dirname, 'vendor-lock.json'), 'utf8'));
    const manifest = { name: 'laverna-nas', private: true, dependencies: {}, resolutions: {} };
    for (const [name, dependency] of Object.entries(locked)) {
        manifest.dependencies[name] = dependency.source + (dependency.commit ? '#' + dependency.target : '');
        if (dependency.commit) manifest.resolutions[name] = dependency.target;
    }
    await fs.writeFile(path.join(staging, 'bower.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.writeFile(path.join(staging, '.bowerrc'), JSON.stringify({
        directory: 'bower_components',
        interactive: false,
        analytics: false,
        storage: {
            packages: path.join(staging, 'cache', 'packages'),
            registry: path.join(staging, 'cache', 'registry'),
            links: path.join(staging, 'cache', 'links')
        }
    }, null, 2));
    await run(process.execPath, [require.resolve('bower/bin/bower'), 'install', '--allow-root'], {
        cwd: staging,
        env: {
            ...process.env,
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
            GIT_CONFIG_VALUE_0: 'git://github.com/'
        }
    });

    for (const [name, dependency] of Object.entries(locked)) {
        const directory = path.join(staging, 'bower_components', name);
        const metadata = JSON.parse(await fs.readFile(path.join(directory, '.bower.json'), 'utf8'));
        if (dependency.commit && metadata._resolution.commit !== dependency.commit) {
            throw new Error('Unexpected Git revision for ' + name);
        }
        for (const [filename, expected] of Object.entries(dependency.sha256 || {})) {
            const actual = createHash('sha256').update(await fs.readFile(path.join(directory, filename))).digest('hex');
            if (actual !== expected) throw new Error('Unexpected file content: ' + name + '/' + filename);
        }
    }

    if (process.argv.includes('--dependencies-only')) return;

    // Only remove this build's generated output, never a user-supplied path.
    await fs.mkdir(path.dirname(output), { recursive: true });
    if (path.relative(root, output) !== path.join('release', 'laverna-nas') ||
        path.relative(await fs.realpath(root), await fs.realpath(path.dirname(output))) !== 'release') {
        throw new Error('Refusing to replace output outside release/laverna-nas');
    }
    await fs.rm(output, { recursive: true, force: true });
    const web = path.join(output, 'web');
    await fs.cp(path.join(root, 'app'), web, {
        recursive: true,
        filter: source => !['bower_components', '.htaccess'].includes(path.basename(source))
    });
    const vendor = path.join(web, 'bower_components');
    await fs.cp(path.join(staging, 'bower_components'), vendor, { recursive: true });
    await fs.copyFile(path.join(vendor, 'dropbox', 'lib', 'dropbox.js'), path.join(vendor, 'dropbox', 'dropbox.js'));

    const styles = path.join(root, 'app', 'styles');
    for (const entry of await fs.readdir(styles, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const filename = path.join(styles, entry.name, 'main.less');
        const result = await less.render(await fs.readFile(filename, 'utf8'), {
            filename,
            paths: [vendor],
            math: 'always'
        });
        await fs.writeFile(path.join(web, 'styles', entry.name + '.css'), result.css);
    }
    // Keep the language order used by the original Gulp task.
    const prismTask = await fs.readFile(path.join(root, 'gulps', 'prism.js'), 'utf8');
    const languages = /var components = '([^']+)'/.exec(prismTask)[1].split('+');
    const prism = await Promise.all(['core', ...languages].map(name =>
        fs.readFile(path.join(vendor, 'prism', 'components', 'prism-' + name + '.js'), 'utf8')
    ));
    await fs.writeFile(path.join(vendor, 'prism', 'bundle.js'), prism.join('\n;\n'));
    await fs.copyFile(path.join(root, 'LICENSE'), path.join(web, 'LICENSE'));
    for (const filename of ['compose.yaml', 'compose.dns.yaml', 'Caddyfile.dns', 'nginx.conf', 'README.md', 'QNAP-START.md', 'DEPLOYMENT.md', '.env.example']) {
        await fs.copyFile(path.join(__dirname, filename), path.join(output, filename));
    }
    for (const directory of ['scripts', 'deploy', 'server', 'updater']) {
        await fs.cp(path.join(__dirname, directory), path.join(output, directory), { recursive: true });
    }
    async function prepareScripts(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) await prepareScripts(filename);
            else {
                const content = (await fs.readFile(filename, 'utf8')).replace(/\r\n/g, '\n')
                    .replaceAll('__LAVERNA_VERSION__', applicationVersion)
                    .replaceAll('__NAS_VERSION__', nasVersion);
                await fs.writeFile(filename, content);
            }
        }
    }
    await prepareScripts(path.join(output, 'scripts'));
    await prepareScripts(path.join(output, 'deploy'));
    await fs.writeFile(path.join(web, 'ready.json'), JSON.stringify({
        ok: true,
        application: 'Laverna',
        version: applicationVersion,
        nasPackage: nasVersion
    }, null, 2) + '\n');
    await fs.writeFile(path.join(output, 'BUILD-INFO.json'), JSON.stringify({
        application: 'Laverna',
        version: applicationVersion,
        nasPackage: nasVersion,
        sourceRevision: process.env.LAVERNA_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dependencies: locked
    }, null, 2) + '\n');

    if (process.argv.includes('--web-only')) return;
    const files = {};
    async function collect(directory, prefix) {
        for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) await collect(filename, prefix + '/' + entry.name);
            else files[prefix + '/' + entry.name] = new Uint8Array(await fs.readFile(filename));
        }
    }
    await collect(output, 'laverna-nas');
    const archive = zipSync(files, { level: 6 });
    const archivePath = output + '.zip';
    await fs.writeFile(archivePath, archive);
    await fs.writeFile(archivePath + '.sha256', createHash('sha256').update(archive).digest('hex') + '  laverna-nas.zip\n');
    console.log('\nNAS package: ' + output);
    console.log('ZIP archive: ' + archivePath);
}

build().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
