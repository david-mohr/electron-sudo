import chai from 'chai';
import dirtyChai from 'dirty-chai';
import Sudoer from '../src/index';

let { expect } = chai;
let { platform } = process;
const PARAM = platform === 'win32' ? '%PARAM%' : '$PARAM';

let sudoer = new Sudoer();
chai.use(dirtyChai);

describe(`electron-sudo :: ${platform}`, function () {

  this.timeout(100000);
  this.slow(100000);

  it('should exec with ENV', async function () {
    let result = await sudoer.exec(`echo ${PARAM}`, {env: {PARAM: 'VALUE'}});
    expect(result.stdout.trim()).to.be.equals('VALUE');
  });

  it('should spawn with ENV', async function () {
    let cp = await sudoer.spawn('echo', [PARAM], {env: {PARAM: 'VALUE'}});
    let output = '';
    cp.stdout.on('data', data => output += data.toString());
    return new Promise(resolve => {
      cp.on('close', () => {
        expect(output.trim()).to.be.equals('VALUE');
        expect(cp.pid).to.be.a('number');
        resolve();
      });
    });
  });
});
