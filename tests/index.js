import chai from 'chai';
import dirtyChai from 'dirty-chai';
import Sudoer from '../src/index';

let { expect } = chai;
let { platform } = process;

let sudoer = new Sudoer();
chai.use(dirtyChai);

describe(`electron-sudo :: ${platform}`, function () {

  this.timeout(100000);
  this.slow(100000);

  if (platform === 'darwin') {
    describe('[exec] with ENV vars', async function () {
      it('should available environment variables', async function () {
        let result = await sudoer.exec('echo $PARAM', {env: {PARAM: 'VALUE'}});
        expect(result.stdout.trim()).to.be.equals('VALUE');
      });
    });
    describe('[spawn] with ENV vars', async function () {
      it('should available environment variables', async function () {
        let cp = await sudoer.spawn('echo', ['$PARAM'], {env: {PARAM: 'VALUE'}});
        let output = ''
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
  }

  if (platform === 'linux') {
    describe('[pkexec: exec] with ENV vars', async function () {
      it('should available environment variables', async function () {
        sudoer.binary = '/usr/bin/pkexec';
        // sudoer.exec('echo $PARAM', {env: {PARAM: 'VALUE'}});
        // await sudoer.exec('echo $PARAM', {env: {PARAM: 'VALUE'}});
        let result = await sudoer.exec('echo $PARAM', {env: {PARAM: 'VALUE'}});
        expect(result.stdout.trim()).to.be.equals('VALUE');
      });
    });
    describe('[pkexec: spawn] with ENV vars', async function () {
      it('should available environment variables', async function () {
        sudoer.binary = '/usr/bin/pkexec';
        let cp = await sudoer.spawn('echo', ['$PARAM'], {env: {PARAM: 'VALUE'}});
        let output = ''
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
  }

  if (platform === 'win32') {
    describe('[exec] with ENV vars', async function () {
      it('should available environment variables', async function () {
        let result = await sudoer.exec('echo %PARAM%', {env: {PARAM: 'VALUE'}});
        expect(result.toString().trim()).to.be.equals('VALUE');
      });
    });
    describe('[spawn] with ENV vars', async function () {
      it('should available environment variables', async function () {
        let cp = await sudoer.spawn('echo', ['%PARAM%'], {env: {PARAM: 'VALUE'}});
        return new Promise(resolve => {
          cp.on('close', () => {
            expect(cp.output.stdout.toString().trim()).to.be.equals('VALUE');
            expect(cp.pid).to.be.a('number');
            resolve();
          });
        });
      });
    });
  }
});
