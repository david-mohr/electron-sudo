const {tmpdir} = require('os');
const {watch, unlink, createReadStream} = require('fs');
const {readFile, writeFile, exec, spawn} = require('./utils');

class Sudoer {

    constructor() {
        this.cp = null;
        this.tmpdir = tmpdir();
    }

    joinEnv(options) {
        let {env} = options,
            spreaded = [];
        if (env && typeof env == 'object') {
            for (let key in env) {
                if (process.platform === 'win32') {
                    spreaded.push(key.concat('=', env[key]));
                } else {
                    spreaded.push(`${key}="${env[key]}"`);
                }
            }
        }
        return spreaded;
    }

    escapeDoubleQuotes(string) {
        return string.replace(/"/g, '\\"');
    }

    encloseDoubleQuotes(string) {
        return string.replace(/(.+)/g, '"$1"');
    }
}

class SudoerDarwin extends Sudoer {

    async exec(command, options={}) {
        return new Promise(async (resolve, reject) => {
            const env = {...process.env, ...options.env};
            try {
                let result = await exec(`osascript -e 'do shell script "${command}" with administrator privileges'`, {env});
                resolve(result);
            } catch (err) {
                reject(err);
            }
        });
    }

    async spawn(command, args, options={}) {
        return new Promise(async (resolve, reject) => {
            this.cp = spawn('osascript', ['-e', `'do shell script "${[command, ...args].join(' ')}" with administrator privileges'`], options);
            this.cp.on('error', async (err) => {
                reject(err);
            });
            resolve(this.cp);
        });
    }
}

class SudoerLinux extends Sudoer {

    async exec(command, options={}) {
        return new Promise(async (resolve, reject) => {
            if (options.env instanceof Object && !options.env.DISPLAY) {
                // Force DISPLAY variable with default value which is required for UI dialog
                options.env = Object.assign(options.env, {DISPLAY: ':0'});
            }
            let flags = '--disable-internal-agent';
          command = `/usr/bin/pkexec ${flags} ${command}`;
            try {
                let result = await exec(command, options);
                return resolve(result);
            } catch (err) {
                return reject(err);
            }
        });
    }

    async spawn(command, args, options={}) {
        return new Promise(async (resolve, reject) => {
            let sudoArgs = ['--disable-internal-agent'];
            if (options.env) {
                sudoArgs.push('env', ...this.joinEnv(options))
            }
            sudoArgs.push(command);
            sudoArgs.push(...args);
            try {
                this.cp = spawn('/usr/bin/pkexec', sudoArgs, options);
                return resolve(this.cp);
            } catch (err) {
                return reject(err);
            }
        });
    }
}

class SudoerWin32 extends Sudoer {

    async writeBatch(command, args, options) {
        let tmpDir = (await exec('echo %temp%'))
                .stdout.toString()
                .replace(/\r\n$/, ''),
            tmpBatchFile = `${tmpDir}\\batch-${Math.random()}.bat`,
            tmpOutputFile = `${tmpDir}\\output-${Math.random()}`,
            env = this.joinEnv(options),
            batch = `setlocal enabledelayedexpansion\r\n`;
        if (env.length) {
            batch += `set ${env.join('\r\nset ')}\r\n`;
        }
        if (args && args.length) {
            batch += `${command} ${args.join(' ')}`;
        } else {
            batch += command;
        }
        await writeFile(tmpBatchFile, `${batch} > ${tmpOutputFile} 2>&1`);
        await writeFile(tmpOutputFile, '');
        return {
            batch: tmpBatchFile, output: tmpOutputFile
        };
    }

    async watchOutput() {
        if (!this.cp) {
            return;
        }
        let output = await readFile(this.cp.files.output);
        // If we have process then emit watched and stored data to stdout
        this.cp.stdout.emit('data', output);
        let readInProgress = false;
        let readAgain = false;
        let start = output.length;
        let tailFile = () => {
            if (readInProgress) {
                readAgain = true;
                return;
            }
            let stream = createReadStream(this.cp.files.output, { start });
            readInProgress = true;
            stream.on('data', (data) => {
                start += data.length;
                if (this.cp) { this.cp.stdout.emit('data', data); }
            });
            const done = () => {
                readInProgress = false;
                if (readAgain) {
                    readAgain = false;
                    tailFile();
                }
            };
            stream.on('error', done);
            stream.on('close', done);
        };
        let watcher = watch(this.cp.files.output, {persistent: true}, tailFile);
        this.cp.on('exit', () => {
            watcher.close();
            this.clean(this.cp.files);
        });
    }

    async exec(command, options={}) {
        return new Promise(async (resolve, reject) => {
            try {
                const files = await this.writeBatch(command, [], options);
                command = `powershell -Command "Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList '/c ${files.batch}'"`;
                // No need to wait exec output because output is redirected to temporary file
                await exec(command, options);
                // Read entire output from redirected file on process exit
                const output = await readFile(files.output);
                this.clean(files);
                return resolve(output);
            } catch (err) {
                return reject(err);
            }
        });
    }

    async spawn(command, args, options={}) {
        let files = await this.writeBatch(command, args, options);
        let sudoArgs = ['-Command', `"Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList '/c ${files.batch}'"`];
        this.cp = spawn('powershell', sudoArgs, options, {wait: false});
        this.cp.files = files;
        await this.watchOutput();
        return this.cp;
    }

    clean (files) {
        unlink(files.batch, () => {});
        unlink(files.output, () => {});
    }
}

module.exports = {SudoerDarwin, SudoerLinux, SudoerWin32};
