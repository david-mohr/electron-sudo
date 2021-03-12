## Electron subprocess with administrative privileges

Run a subprocess with administrative privileges, prompting the user with a graphical OS dialog if necessary. Useful for background subprocesse which run native Electron apps that need sudo.

Uses in-built OS features, no binaries required

## Features
  - Supports ```spawn``` and ```exec``` subprocess behavior
  - Supports applications packaged as ```asar``` archive
  - Separate password prompt for each call (use ```sh``` or ```bat``` script for single prompt)
  - No external dependencies, does not depend on OS versions

## Installation
```
npm install david-mohr/electron-sudo
```

## Usage
**Note: Your command should not start with the ```sudo``` prefix.**

### Version 5

```js
import sudo from 'electron-sudo';

/* Spawn subprocess behavior */
let cp = await sudo.spawn(
  'echo', ['$PARAM'], {env: {PARAM: 'VALUE'}}
);
cp.on('close', () => {
  /*
    cp.output.stdout (Buffer)
    cp.output.stderr (Buffer)
  */
});

/* Exec subprocess behavior */
let result = await sudo.exec(
  'echo $PARAM', {env: {PARAM: 'VALUE'}}
);
/* result is an object with props stdout and stderr (both Buffers) */
```

## Tests
```
npm i && npm test
```

## Thanks
Based on the original `electron-sudo` by Aleksandr Komlev
