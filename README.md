# TypeScript SFTP Server

Implement a simple SFTP Server using TypeScript and Node.js.

> **Warning**
> Not all FTP methods are implemented.

<br/>

Based on work by [@mscdex](https://github.com/mscdex) - [ssh2](https://github.com/mscdex/ssh2), [ssh2-streams](https://github.com/mscdex/ssh2-streams).
Inspired by the work of [@validityhq](https://github.com/validityhq) - [node-sftp-server](https://github.com/validityhq/node-sftp-server) and [@expressjs](https://github.com/expressjs) - [express](https://github.com/expressjs/express).

## How to use

1) First, import the SFTP Server module
```js
import SFTPServer from "ts-sftp-server";
```
2) Instanciate the server
```js
let sftpServer = new SFTPServer({
  port: 3000,
  privateKeyFilePath: PRIVATE_KEY_FILE_PATH,
  authMethods: ['password'],
  printMethods: {
    // Print to console on error (not mandatory to implement)
    onError: (msg: string) => {
      // console.log(msg);
    },
    // Print to console on operation success (not mandatory to implement)
    onSuccess: (msg: string) => {
      // console.log(msg);
    },
    // Print to console warnings (not mandatory to implement)
    onWarning: (msg: string) => {
      // console.log(msg);
    },
  },
});
```

3) Implement the following events

|Event                |Description                                                                                |
|---------------------|-------------------------------------------------------------------------------------------|
|Connection           |Allow/Refuse connection                                                                    |
|Auth                 |User authentication                                                                        |
|RENAME               |Rename a file/folder inside the server                                                     |
|REMOVE               |Remove file from the server                                                                |
|SETSTAT              |Change file properties                                                                     |
|WRITE                |Write changes to a file                                                                    |
|READ                 |Read file content                                                                          |
|OPENDIR              |Client request to open a certain directory                                                 |
|RMDIR                |Client request to remove a certain directory                                               |
|MKDIR                |Client request to create a certain directory                                               |
|READDIR              |Client request to read list of a directory's contents alongside that content's permissions |
|CLOSE                |Client closing pointer to a certain file/directory                                         |
|REALPATH             |Tell client information related to a path                                                  |
|LSTAT,STAT,FSTAT     |Tell client information related to a file/directory                                        |

<br/>

The example inside the folder "test" demos the implementation of an SFTP Server using TypeScript


## Funding

| Funding | Description |
|--|--|
| <p align="center"><img style="float: right;" width="200" src="https://neurorehablab.arditi.pt/wp-content/uploads/2021/03/logo_mac.jpg">MACbioIDi2</p>  | Contribuyendo a la cohesión e internacionalización de la Macaronesia para impulsarlos Objetivos del Desarrollo Sostenible con las TICs y la I+D+i biomédica |
| <p align="center"><img style="float: right;" width="200" src="https://pbs.twimg.com/profile_images/1617678149474451456/xRShzGiM_400x400.jpg">NeuroRehabLab</p> | The NeuroRehabLab is an interdisciplinary research group of the University of Madeira that investigates the intersection of technology, neuroscience, and clinical practice to find novel solutions to increase the quality of life of those with special needs. We capitalize on Virtual Reality, Serious Games, and Brain-Computer Interfaces to exploit specific brain mechanisms that relate to functional recovery to approach motor and cognitive rehabilitation by means of non-invasive and low-cost technologies. |
