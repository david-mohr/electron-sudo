import chai from 'chai';
import dirtyChai from 'dirty-chai';
import Sudoer from '../src/index';

let { expect } = chai;
let { platform } = process;
const PARAM = platform === 'win32' ? '%PARAM%' : '$PARAM';

let sudoer = new Sudoer();
chai.use(dirtyChai);

describe(`electron-sudo :: ${platform}`, function () {

  this.timeout(10000);
  this.slow(10000);

  it('should exec with ENV', async function () {
    let result = await sudoer.exec(`echo ${PARAM}`, {env: {PARAM: 'VALUE'}});
    expect(result.stdout.trim()).to.be.equals('VALUE');
  });

  it('should spawn with ENV', async function () {
    let cp = await sudoer.spawn('echo', [PARAM], {env: {PARAM: 'VALUE'}, shell: true});
    let output = '';
    cp.stdout.on('data', data => output += data.toString());
    return new Promise(resolve => {
      cp.on('exit', () => {
        expect(output.trim()).to.be.equals('VALUE');
        expect(cp.pid).to.be.a('number');
        resolve();
      });
    });
  });

  it('should spawn and capture stderr', async function () {
    let cp = await sudoer.spawn('node', ['-e', 'console.error("VALUE")']);
    let output = '';
    cp.stderr.on('data', data => output += data.toString());
    return new Promise(resolve => {
      cp.on('exit', () => {
        expect(output.trim()).to.be.equals('VALUE');
        resolve();
      });
    });
  });

  it('should support single and double quotes', async function () {
    let cp = await sudoer.spawn('node', ['-e', `console.log('VAL' + "UE")`]);
    let output = '';
    cp.stdout.on('data', data => output += data.toString());
    return new Promise(resolve => {
      cp.on('exit', () => {
        expect(output.trim()).to.be.equals('VALUE');
        resolve();
      });
    });
  });

  it('should spawn and report stdout immediately', async function () {
    let cp = await sudoer.spawn('node', ['-e', `console.log('VAL1'); setTimeout(() => console.log('VAL2'), 2000)`]);
    let output = '';
    let output1s;
    cp.stdout.on('data', data => {
      output += data.toString();
      if (!output1s) {
        output1s = output;
      }
    });
    return new Promise(resolve => {
      cp.on('exit', () => {
        expect(output1s.trim()).to.be.equals(`VAL1`);
        expect(output.trim()).to.match(/VAL1[\r\n]+VAL2/);
        resolve();
      });
    });
  });

  it('should spawn concurrently', async function () {
    let cp1 = await sudoer.spawn('node', ['-e', `setTimeout(() => console.log('VAL1'), 2000)`]);
    let cp2 = await sudoer.spawn('node', ['-e', `console.log('VAL2')`]);
    let output1 = '';
    let output2 = '';
    cp1.stdout.on('data', data => output1 += data.toString());
    cp2.stdout.on('data', data => output2 += data.toString());
    let gotOne = false;
    return new Promise(resolve => {
      cp1.on('close', () => {
        expect(output1.trim()).to.be.equals(`VAL1`);
        if (gotOne) {
          resolve();
        } else {
          gotOne = true;
        }
      });
      cp2.on('close', () => {
        expect(output2.trim()).to.be.equals(`VAL2`);
        if (gotOne) {
          resolve();
        } else {
          gotOne = true;
        }
      });
    });
  });
});
