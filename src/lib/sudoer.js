const child = require('child_process');
const { readFile, writeFile, mkdtemp, rmdir } = require('fs').promises;
const { tmpdir } = require('os');
const path = require('path');
const { watch, watchFile, createReadStream } = require('fs');

async function exec(cmd, options={}) {
  return new Promise((resolve, reject) => {
    child.exec(cmd, options, (err, stdout, stderr) => {
      if (err) { return reject(err); }
      return resolve({stdout, stderr});
    });
  });
}

class Sudoer {

  async makeTempDir() {
    const files = {};
    files.dir = await mkdtemp(path.join(tmpdir(), 'electron sudo-'));
    files.stdout = path.join(files.dir, 'stdout');
    files.stderr = path.join(files.dir, 'stderr');
    // console.dir(files)
    await Promise.all([
      writeFile(files.stdout, ''),
      writeFile(files.stderr, '')
    ]);
    return files;
  }

  joinEnv(env) {
    let spreaded = [];
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

  _watch(cp, files, name) {
    let readInProgress = false;
    let readAgain = false;
    let start = 0;
    let tail = () => {
      if (readInProgress) {
        readAgain = true;
        return;
      }
      let stream = createReadStream(files[name], { start });
      readInProgress = true;
      stream.on('data', (data) => {
        start += data.length;
        if (cp) { cp[name].emit('data', data); }
      });
      const done = () => {
        readInProgress = false;
        if (readAgain) {
          readAgain = false;
          tail();
        }
      };
      stream.on('error', done);
      stream.on('close', done);
    };
    setImmediate(() => tail());
    if (process.platform === 'win32') {
      return watchFile(files[name], { interval: 200, persistent: false }, tail);
    } else {
      return watch(files[name], { persistent: false }, tail);
    }
  }

  async clean (files) {
    if (!files || !files.dir) {
      return;
    }
    await rmdir(files.dir, {recursive: true});
  }

  _prepParam(param) {
    if (/['" ]/.test(param)) {
      if (process.platform === 'win32') {
        return '"' + param.replace(/"/g, '""') + '"';
      }
      return '"' + param.replace(/"/g, '\\"') + '"';
    }
    return param;
  }
}

class SudoerDarwin extends Sudoer {
  // https://developer.apple.com/library/archive/technotes/tn2065/_index.html

  async exec(command, options={}) {
    return exec(`osascript -e 'do shell script "${command}" without altering line endings with administrator privileges'`, options);
  }

  // osascript doesn't stream stdout/stderr, so we're force to redirect to file
  async spawn(command, args, options={}) {
    const files = await this.makeTempDir();
    let cmd = [command, ...args].map(this._prepParam).join(' ');
    // command is going inside double quotes, escape quotes and backslashes
    cmd = cmd.replace(/([\\"])/g, '\\$1');
    let osaArgs = ['-e', `do shell script "${cmd} >> \\"${files.stdout}\\" 2>> \\"${files.stderr}\\"" without altering line endings with administrator privileges`];
    if (options.shell) {
      osaArgs[1] = `'` + osaArgs[1].replace(/'/g, `'\\''`) + `'`;
    }
    const cp = child.spawn('osascript', osaArgs, options);
    this._watch(cp, files, 'stdout');
    this._watch(cp, files, 'stderr');
    cp.on('exit', () => {
      this.clean(files);
    });
    return cp;
  }
}

class SudoerLinux extends Sudoer {
  async exec(command, options={}) {
    return exec(`/usr/bin/pkexec --disable-internal-agent ${command}`, options);
  }

  async spawn(command, args, options={}) {
    let sudoArgs = ['--disable-internal-agent'];
    if (options.env) {
      sudoArgs.push('env', ...this.joinEnv(options.env));
    }
    sudoArgs.push(command);
    sudoArgs.push(...args);
    return child.spawn('/usr/bin/pkexec', sudoArgs, options);
  }
}

class SudoerWin32 extends Sudoer {

  async writeBatch(command, args, options) {
    const files = await this.makeTempDir();
    files.batch = path.join(files.dir, 'batch.bat');
    let env = this.joinEnv(options.env);
    let batch = `setlocal enabledelayedexpansion\r\n`;
    if (env.length) {
      batch += `set ${env.join('\r\nset ')}\r\n`;
    }
    // check the command and all the args for spaces and double quotes
    if (args && args.length) {
      batch += [command, ...args].map(this._prepParam).join(' ');
    } else {
      batch += command;
    }
    await writeFile(files.batch, `${batch} >> "${files.stdout}" 2>> "${files.stderr}"`);
    return files;
  }

  async exec(command, options={}) {
    return new Promise(async (resolve, reject) => {
      try {
        const files = await this.writeBatch(command, [], options);
        // DOS shell: two double quotes to escape
        command = `powershell -Command "Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList ""/c ${files.batch.replace(/ /g, '^ ')}"""`;
        // No need to wait exec output because output is redirected to temporary file
        await exec(command, options);
        // Read entire output from redirected file on process exit
        const output = await Promise.all([
          readFile(files.stdout, 'utf8'),
          readFile(files.stderr, 'utf8')
        ]);
        this.clean(files);
        return resolve({stdout: output[0], stderr: output[1]});
      } catch (err) {
        return reject(err);
      }
    });
  }

  async spawn(command, args, options={}) {
    const files = await this.writeBatch(command, args, options);
    // DOS shell: two double quotes to escape
    let sudoArgs = ['-Command', `Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList "/c ${files.batch.replace(/ /g, '^ ')}"`];
    if (options.shell) {
      sudoArgs[1] = '"' + sudoArgs[1].replace(/"/g, '""') + '"';
    }
    let cp = child.spawn('powershell', sudoArgs, options);
    this._watch(cp, files, 'stdout');
    this._watch(cp, files, 'stderr');
    cp.on('exit', () => {
      this.clean(files);
    });
    return cp;
  }
}

module.exports = {SudoerDarwin, SudoerLinux, SudoerWin32};
