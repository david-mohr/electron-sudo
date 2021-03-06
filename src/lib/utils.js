const fs = require('fs');
const child = require('child_process')

function promisify(fn) {
    return function() {
        return new Promise((resolve, reject) => {
            fn(...arguments, function () {
                if (arguments[0] instanceof Error) {
                    reject(arguments[0]);
                } else {
                    resolve(...Array.prototype.slice.call(arguments, 1));
                }
            });
        });
    };
}

async function exec(cmd, options={}) {
    return new Promise((resolve, reject) => {
        child.exec(cmd, options, (err, stdout, stderr) => {
            if (err) { return reject(err); }
            return resolve({stdout, stderr});
        });
    });
}

function spawn(cmd, args, options={}) {
    let cp = child.spawn(cmd, args, {...options, shell: true});
    cp.output = { stdout: new Buffer.alloc(0), stderr: new Buffer.alloc(0) };
    cp.stdout.on('data', (data) => {
        cp.output.stdout = concat(data, cp.output.stdout);
    });
    cp.stderr.on('data', (data) => {
        cp.output.stderr = concat(data, cp.output.stderr);
    });
    return cp;
}

function concat(source, target) {
    if (!(source instanceof Buffer)) {
        source = new Buffer.from(source, 'utf8');
    }
    if (!target instanceof Buffer) {
        target = new Buffer.alloc(0);
    }
    return Buffer.concat([target, source]);
}

let readFile = promisify(fs.readFile),
    writeFile = promisify(fs.writeFile);


module.exports = {readFile, writeFile, spawn, exec};
