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

  constructor() {
    this.cp = null;
    this.files = {};
  }

  async makeTempDir() {
    this.files.dir = await mkdtemp(path.join(tmpdir(), 'electron sudo-'));
    this.files.stdout = path.join(this.files.dir, 'stdout');
    this.files.stderr = path.join(this.files.dir, 'stderr');
    // console.dir(this.files)
    await Promise.all([
      writeFile(this.files.stdout, ''),
      writeFile(this.files.stderr, '')
    ]);
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

  escapeDoubleQuotes(string) {
    return string.replace(/"/g, '\\"');
  }

  encloseDoubleQuotes(string) {
    return string.replace(/(.+)/g, '"$1"');
  }
}

class SudoerDarwin extends Sudoer {
  // https://developer.apple.com/library/archive/technotes/tn2065/_index.html

  async exec(command, options={}) {
    let tmpDir = await this.makeTempDir();
    return exec(`osascript -e 'do shell script "${command} > '${tmpDir.stdout}' 2> '${tmpDir.stderr}'" without altering line endings with administrator privileges'`, options);
  }

  async spawn(command, args, options={}) {
    return new Promise(async (resolve, reject) => {
      let tmpDir = await this.makeTempDir();
      this.cp = child.spawn('osascript', ['-e', `'do shell script "${[command, ...args].join(' ')} > '${tmpDir.stdout}' 2> '${tmpDir.stderr}'" without altering line endings with administrator privileges'`], options);
      this.cp.on('error', async (err) => {
        reject(err);
      });
      resolve(this.cp);
    });
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

  _prepParam(param) {
    if (/"/.test(param)) {
      return '"' + param.replace(/"/g, '""') + '"';
    }
    if (/ /.test(param)) {
      return '"' + param + '"';
    }
    return param;
  }
  async writeBatch(command, args, options) {
    await this.makeTempDir();
    this.files.batch = path.join(this.files.dir, 'batch.bat');
    let env = this.joinEnv(options.env);
    let batch = `setlocal enabledelayedexpansion\r\n`;
    if (env.length) {
      batch += `set ${env.join('\r\nset ')}\r\n`;
    }
    // check the command and all the args for spaces and double quotes
    if (args && args.length) {
      batch += this._prepParam(command) + ' ' + args.map(this._prepParam).join(' ');
    } else {
      batch += command;
    }
    await writeFile(this.files.batch, `${batch} >> "${this.files.stdout}" 2>> "${this.files.stderr}"`);
  }

  _watch(name) {
    let readInProgress = false;
    let readAgain = false;
    let start = 0;
    let tail = () => {
      if (readInProgress) {
        readAgain = true;
        return;
      }
      let stream = createReadStream(this.files[name], { start });
      readInProgress = true;
      stream.on('data', (data) => {
        start += data.length;
        if (this.cp) { this.cp[name].emit('data', data); }
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
    if (process.platform === 'win32') {
      return watchFile(this.files[name], { interval: 200, persistent: false }, tail);
    } else {
      return watch(this.files[name], { persistent: false }, tail);
    }
  }

  async exec(command, options={}) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.writeBatch(command, [], options);
        // DOS shell: two double quotes to escape
        command = `powershell -Command "Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList ""/c ${this.files.batch.replace(/ /g, '^ ')}"""`;
        // No need to wait exec output because output is redirected to temporary file
        await exec(command, options);
        // Read entire output from redirected file on process exit
        const output = await Promise.all([
          readFile(this.files.stdout, 'utf8'),
          readFile(this.files.stderr, 'utf8')
        ]);
        this.clean();
        return resolve({stdout: output[0], stderr: output[1]});
      } catch (err) {
        return reject(err);
      }
    });
  }

  async spawn(command, args, options={}) {
    await this.writeBatch(command, args, options);
    this._watch('stdout');
    this._watch('stderr');
    // DOS shell: two double quotes to escape
    let sudoArgs = ['-Command', `Start-Process cmd -Verb RunAs -WindowStyle hidden -Wait -ArgumentList "/c ${this.files.batch.replace(/ /g, '^ ')}"`];
    if (options.shell) {
      sudoArgs[1] = '"' + sudoArgs[1].replace(/"/g, '""') + '"';
    }
    this.cp = child.spawn('powershell', sudoArgs, options);
    this.cp.on('exit', () => {
      this.clean();
    });
    return this.cp;
  }

  async clean () {
    if (!this.files || !this.files.dir) {
      return;
    }
    await rmdir(this.files.dir, {recursive: true});
  }
}

module.exports = {SudoerDarwin, SudoerLinux, SudoerWin32};
