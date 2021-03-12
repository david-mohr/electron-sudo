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
});
