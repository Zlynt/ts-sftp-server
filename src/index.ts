// #region Dependencies
// SSH Dependencies
import * as ssh2 from 'ssh2';
import * as ssh2_stream from 'ssh2-streams';
// const SFTP = ssh2_stream.SFTPStream;
// Stream dependencies
import { Readable, Writable, Transform } from 'stream';
// Events
import { EventEmitter } from 'events';
// FS
import * as fs from 'fs-extra';
// Path
import * as path from 'path';
// Crypto
import { generateKeyPairSync } from 'crypto';
// Constants
import * as constants from 'constants';
// #endregion

export interface ConsolePrintMethod {
  (...args: any): void;
}
export type AuthMethodType = 'none' | 'password' | 'hostbased' | 'publickey' | 'keyboard-interactive';

export interface SftpServerProps {
  readonly port: number;
  readonly privateKeyFilePath: string;
  printMethods?: {
    onWarning?: ConsolePrintMethod;
    onError?: ConsolePrintMethod;
    onSuccess?: ConsolePrintMethod;
  };
  authMethods: Array<AuthMethodType>;
}

export interface RemoteInfo {
  ip: string;
  ipFamily: string;
  port: number;
  client: {
    softwareIdentification: string;
    software: string;
  };
}

export default class SFTPServer extends EventEmitter {
  #port: number;
  #privateKey: Buffer;
  #server: ssh2.Server;
  // Custom print methods
  #printWarning: ConsolePrintMethod;
  #printError: ConsolePrintMethod;
  #printSuccess: ConsolePrintMethod;
  #authMethods: Array<AuthMethodType>;
  #midlewares: Array<(req: any, res: any, next: () => void) => void>;

  constructor({ port, privateKeyFilePath, printMethods, authMethods }: SftpServerProps) {
    super();

    // #region Initialize printing methods
    this.#printWarning = printMethods?.onWarning ? printMethods?.onWarning : () => {};
    this.#printError = printMethods?.onError ? printMethods?.onError : () => {};
    this.#printSuccess = printMethods?.onSuccess ? printMethods?.onSuccess : () => {};
    // #endregion

    // #region Initialize parameters
    // Initialize midleware
    this.#midlewares = [];
    // Server Port
    this.#port = port;
    // Auth methods
    this.#authMethods = authMethods;
    // Private Key File
    // If cert does not exist, generate it
    if (!fs.existsSync(privateKeyFilePath) || !fs.statSync(privateKeyFilePath).isFile()) {
      fs.ensureDirSync(path.join(privateKeyFilePath, '..'));
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs1',
          format: 'pem',
        },
      });
      fs.writeFileSync(privateKeyFilePath, privateKey.toString());
    }
    this.#privateKey = fs.readFileSync(privateKeyFilePath);
    // #endregion

    let _this = this;

    // #region Initialize Server
    this.#server = new ssh2.Server(
      {
        hostKeys: [this.#privateKey],
      },
      (client: ssh2.Connection, info: ssh2.ClientInfo) => {
        const remoteInfo: RemoteInfo = {
          ip: info.ip,
          ipFamily: info.family,
          port: info.port,
          client: {
            softwareIdentification: info.header.identRaw,
            software: info.header.versions.software,
          },
        };

        const isConnectionDefined = _this.emit('Connection', remoteInfo, {
          send: (response: boolean) => {
            if (response === true) {
              this.#printWarning(`${info.ip} was authorized to connect to this server`);
              this.#handleClient(_this, remoteInfo, client, info);
            } else {
              client.end();
            }
          },
        });
        // Check if "Connection" Event was implemented. If it was not, accept connection
        if (isConnectionDefined === false) {
          this.#handleClient(_this, remoteInfo, client, info);
        }
      },
    );
    // #endregion
  }

  use(midleware: (req: any, res: any, next: any) => void) {
    this.#midlewares.push(midleware);
  }

  #executeMidleware(req: any, res: any, _this: SFTPServer, eventString: string) {
    const midlewareLength = this.#midlewares.length;
    let midlewarePointer = 0;
    const next = () => {
      midlewarePointer += 1;
      if (midlewarePointer >= midlewareLength) _this.emit(eventString, req, res);
      else this.#midlewares[midlewarePointer](req, res, next);
    };
    this.#midlewares[midlewarePointer](req, res, next);
    /*for (let i = 0; i < this.#midlewares.length; i += 1) {
      let stopCycle = true;
      const next = () => {
        stopCycle = false;
      };
      req.command = eventString;
      this.#midlewares[i](req, res, next);
      if (stopCycle) return;
    }*/
  }

  #handleSFTPSession(
    _this: SFTPServer,
    remoteInfo: RemoteInfo,
    client: ssh2.Connection,
    info: ssh2.ClientInfo,
    session: ssh2.SFTPWrapper,
    username: string,
  ) {
    this.#printWarning(`Started SFTP session for user '${username}'`);

    // A handle is a pointer to the operation. It shall be a number.
    let _handleCounter = 0; // Increment this when getting a new handle
    let _handles: any = {};

    // Rename file
    session.on('RENAME', (reqId: number, path: string, toPath: string) => {
      this.#printWarning(`Session - RENAME was invoked (ID: ${reqId} ; Path: ${path} -> ${toPath})`);

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
        toPath,
      };
      let res = {
        allow: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'RENAME');
    });

    // Remove file
    session.on('REMOVE', (reqId: number, path: string) => {
      this.#printWarning(`Session - REMOVE was invoked (ID: ${reqId} ; Path: ${path})`);

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
      };
      let res = {
        allow: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'REMOVE');
    });

    // Create directory
    session.on('MKDIR', (reqId: number, path: string) => {
      this.#printWarning(`Session - MKDIR was invoked (ID: ${reqId} ; Path: ${path})`);

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
      };
      let res = {
        allow: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'MKDIR');
    });

    // Remove directory
    session.on('RMDIR', (reqId: number, path: string) => {
      this.#printWarning(`Session - RMDIR was invoked (ID: ${reqId} ; Path: ${path})`);

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
      };
      let res = {
        allow: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'RMDIR');
    });

    // OpenDir Request - Open directory pointer
    session.on('OPENDIR', (reqId: number, path: string) => {
      this.#printWarning(`Session - OPENDIR was invoked (ID: ${reqId} ; Path: ${path})`);

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
      };
      let res = {
        allow: () => {
          // Assign handle to current opened directory
          const currentHandleID = _handleCounter;
          _handleCounter += 1; // Increment counter
          _handles[`H${currentHandleID}`] = {
            path,
            mode: 'OPENDIR',
            reqId,
            username,
          };
          session.handle(reqId, Buffer.from(currentHandleID.toString()));
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
        notFound: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'OPENDIR');
    });

    session.on('READDIR', (reqId: number, handleID: string) => {
      const handle = _handles[`H${handleID}`];
      this.#printWarning(`Session - READDIR was invoked (ID: ${reqId} ; Handle: ${handleID} ; Path: ${handle.path})`);

      if (handle.username !== username) {
        session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        return;
      }

      if (handle.mode !== 'OPENDIR') {
        session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);
        return;
      }

      if (handle.READDIR_TO_SEND !== undefined) {
        if (handle.READDIR_TO_SEND.length > 0) {
          session.name(reqId, [_handles[`H${handleID}`].READDIR_TO_SEND[0]]);
          _handles[`H${handleID}`].READDIR_TO_SEND.shift();
          return;
        }
        if (handle.READDIR_TO_SEND.length <= 0) {
          delete _handles[`H${handleID}`].READDIR_TO_SEND;
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.EOF);
          return;
        }
      }

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path: handle.path,
      };

      let res = {
        send: (
          contentList: Array<{
            contentName: string;
            uid: number;
            gid: number;
            lastAccessTimestamp: number;
            lastModifiedTimestamp: number;
            size: number;
            typeOfContent: 'directory' | 'file';
            permissions: number;
          }>,
        ) => {
          let toSend: ssh2.FileEntry[] = [];
          contentList.forEach((fileDetails) => {
            try {
              toSend.push({
                filename: fileDetails.contentName.toString(),
                longname: fileDetails.contentName.toString(),
                attrs: {
                  mode:
                    (fileDetails.typeOfContent === 'directory' ? fs.constants.S_IFDIR : fs.constants.S_IFREG) |
                    fileDetails.permissions, // Bit mask of file type and permissions
                  uid: fileDetails.uid, // User ID that owns the file.
                  gid: fileDetails.gid, // Group ID that owns the file.
                  size: fileDetails.size, // File size in bytes.
                  atime: fileDetails.lastAccessTimestamp, // Created at (unix style timestamp in seconds-from-epoch).
                  mtime: fileDetails.lastModifiedTimestamp, // Modified at (unix style timestamp in seconds-from-epoch).
                },
              });
            } catch (err) {
              console.log('Error:', err);
            }
          });
          /*
           If folder is empty, send END_OF_FILE parameter. Otherwise, send file list, 
           one file at time and one file per request to the current handle
           */
          if (toSend.length > 0) {
            _handles[`H${handleID}`].READDIR_TO_SEND = toSend;
            session.name(reqId, [_handles[`H${handleID}`].READDIR_TO_SEND[0]]);
            _handles[`H${handleID}`].READDIR_TO_SEND.shift();
          } else {
            session.status(reqId, ssh2.utils.sftp.STATUS_CODE.EOF);
          }
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
        notFound: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'READDIR');
    });

    session.on('CLOSE', async (reqId: number, handleID: string) => {
      const handle = _handles[`H${handleID}`];
      this.#printWarning(`Session - CLOSE was invoked (ID: ${reqId} ; Handle: ${handleID} ; Path: ${handle.path})`);
      switch (handle.mode) {
        case 'READ':
        case 'WRITE':
          await fs.close(_handles[`H${handleID}`].fileDescriptor);
        case 'OPENDIR':
          delete _handles[`H${handleID}`];
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
          return;
        default:
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
      }
    });

    // RealPath Request - request information about absolute path of a certain path
    session.on('REALPATH', (reqId: number, path: string) => {
      this.#printWarning(`Session - REALPATH was invoked (ID: ${reqId} ; Path: ${path} )`);
      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
      };
      let res = {
        send: (
          realFolderPath: string,
          fakeFolderPath: string,
          fakeAtributes?: {
            mode: number;
            uid: number;
            gid: number;
            size: number;
            atime: number;
            mtime: number;
            owner: string;
            ownerGroup: string;
          },
        ) => {
          this.#printWarning(
            `REALPATH - Sending path details: ${realFolderPath} , known by the client has ${fakeFolderPath}`,
          );
          if (!fs.existsSync(realFolderPath) && fakeAtributes === undefined)
            return session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);

          let attributes: any = {
            mode: fakeAtributes?.mode,
            uid: fakeAtributes?.uid,
            gid: fakeAtributes?.gid,
            size: fakeAtributes?.size,
            atime: fakeAtributes?.atime,
            mtime: fakeAtributes?.mtime,
          };
          let ownerInfo = {
            name: fakeAtributes?.owner,
            group: fakeAtributes?.ownerGroup,
          };

          // If no attributes are set, fetch them from file system
          if (fakeAtributes === undefined) {
            let stat = fs.statSync(realFolderPath);
            attributes = {
              mode: stat.mode,
              uid: stat.uid,
              gid: stat.gid,
              size: stat.size,
              atime: stat.atimeMs,
              mtime: stat.mtimeMs,
            };
            ownerInfo.name = 'root';
            ownerInfo.group = 'root';
          }

          session.name(reqId, [
            {
              filename: fakeFolderPath,
              longname: `-rwxrwxrwx 1 ${ownerInfo.name} ${ownerInfo.group} 3 Dec 8 2009 ${fakeFolderPath}`,
              attrs: attributes,
            },
          ]);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
        notFound: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);
          return;
        },
      };
      this.#executeMidleware(req, res, _this, 'REALPATH');
    });

    const STAT = (reqId: number, path: string, typeOfStat: 'LSTAT' | 'STAT' | 'FSTAT') => {
      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
      };
      /**
       * Some info:
       * Current type indicates if we are describing a file or directory
       * Permissions must be received in octal format
       * uid - Owner ID
       * gid - Owner group ID
       * size - file/folder size
       * atime - Creation timestamp
       * mtime - Last modification timestamp
       */
      const send = (
        currType: number,
        permissions: number,
        uid: number,
        gid: number,
        size: number,
        atime: number,
        mtime: number,
      ) => {
        const atributes = {
          mode: currType | permissions,
          uid: uid,
          gid: gid,
          size: size,
          atime: atime,
          mtime: mtime,
        };

        session.attrs(reqId, atributes);
      };
      let res = {
        // Permission must be of octal type ( Example: 0o755 )
        sendFile: (permissions: number, uid: number, gid: number, size: number, atime: number, mtime: number) => {
          // File constant
          const currType = constants.S_IFREG;

          send(currType, permissions, uid, gid, size, atime, mtime);
          return;
        },
        sendDirectory: (permissions: number, uid: number, gid: number, size: number, atime: number, mtime: number) => {
          // Directory constant
          const currType = constants.S_IFDIR;

          send(currType, permissions, uid, gid, size, atime, mtime);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
        notFound: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, typeOfStat);
    };
    // STAT - Request information about file/folder by path name
    session.on('STAT', (reqId: number, path: string) => {
      this.#printWarning(`Session - STAT was invoked (ID: ${reqId} ; Path: ${path})`);
      STAT(reqId, path, 'STAT');
    });
    // LSTAT - Similar to STAT, but if file/folder is a symbolic link return information about link itself, not the file it refers to
    session.on('LSTAT', (reqId: number, path: string) => {
      this.#printWarning(`Session - LSTAT was invoked (ID: ${reqId} ; Path: ${path})`);
      STAT(reqId, path, 'LSTAT');
    });
    // TODO: FSTAT - Similar to STAT, but for current file pointed by handle
    session.on('FSTAT', (reqId: number, handleID: Buffer) => {
      const handle = _handles[`H${handleID}`];
      this.#printWarning(`Session - FSTAT was invoked (ID: ${reqId} ; Handle: ${handleID} ; Path: ${handle.path})`);

      if (handle !== undefined) {
        return STAT(reqId, handle.path, 'FSTAT');
      }

      session.status(reqId, ssh2.utils.sftp.STATUS_CODE.NO_SUCH_FILE);
      return;
    });

    session.on('ready', () => {
      this.#printWarning(`Session - ready was invoked`);
    });

    session.on('OPEN', (reqId: number, filename: string, flags: number, attrs: ssh2.Attributes) => {
      const fileFlags = ssh2_stream.SFTPStream.flagsToString(flags);
      this.#printWarning(
        `Session - OPEN was invoked (ID: ${reqId} ; Path: ${filename} ; Flags: ${fileFlags} ; Atributes: ${JSON.stringify(
          attrs,
        )})`,
      );

      if (fileFlags === null || fileFlags === undefined) {
        session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
        return;
      }

      let operationType: 'WRITE' | '' | 'READ' = fileFlags.toLocaleLowerCase().includes('w')
        ? 'WRITE'
        : fileFlags.toLocaleLowerCase().includes('r')
        ? 'READ'
        : '';

      if (operationType === '') {
        session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
        return;
      }

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path: filename,
      };

      let res: any = {
        /*
          allow: () => {
            let operationBufferPipe: fs.WriteStream | Readable | undefined =
              undefined;
            const tmpUploadFile = randomstring.generate(20);
            if (fileFlags.toLocaleLowerCase().includes("w")) {
              operationType = "WRITE";
              operationBufferPipe = new Readable();
            } else if (fileFlags.toLocaleLowerCase().includes("r")) {
              operationType = "READ";
              operationBufferPipe = fs.createWriteStream(
                path.join(this.#tmpFolder, tmpUploadFile)
              );
            }

            // Assign handle to current opened directory
            const currentHandleID = _handleCounter;
            _handleCounter += 1; // Increment counter
            _handles[`H${currentHandleID}`] = {
              path: filename,
              tmpPath: tmpUploadFile,
              mode: operationType,
              fsStream: operationBufferPipe,
              reqId,
              username,
            };

            return;
          },*/
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
      };

      if (operationType === 'READ') {
        res.sendFile = (filePath: string) => {
          // Assign handle to current opened directory
          const currentHandleID = _handleCounter;
          _handleCounter += 1; // Increment counter
          _handles[`H${currentHandleID}`] = {
            path: filename,
            mode: operationType,
            readFromFilePath: filePath,
            readFromFileSize: fs.statSync(filePath).size,
            fileDescriptor: fs.openSync(filePath, 'r'),
            reqId,
            username,
          };

          session.handle(reqId, Buffer.from(currentHandleID.toString()));
          return;
        };
        this.#executeMidleware(req, res, _this, 'READ');
      } else if (operationType === 'WRITE') {
        res.receiveFile = (filePath: string) => {
          // Assign handle to current opened directory
          const currentHandleID = _handleCounter;
          _handleCounter += 1; // Increment counter
          _handles[`H${currentHandleID}`] = {
            path: filename,
            mode: operationType,
            writeFileToPath: filePath,
            fileSize: attrs.size,
            fileDescriptor: fs.openSync(filePath, 'w'),
            reqId,
            username,
          };

          session.handle(reqId, Buffer.from(currentHandleID.toString()));
          return;
        };
        this.#executeMidleware(req, res, _this, 'WRITE');
      }
    });
    session.on('READ', async (reqId: number, handleID: Buffer, offset: number, len: number) => {
      const handle = _handles[`H${handleID}`];
      this.#printWarning(
        `Session - READ was invoked (ID: ${reqId} ; Handle: ${handleID} ; Path: ${handle.path} ; Offset: ${offset} ; Length: ${len})`,
      );

      if (handle.username !== username) {
        session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        return;
      }

      // If we already sent all file data, return end of file
      if (offset >= handle.readFromFileSize) {
        session.status(reqId, ssh2.utils.sftp.STATUS_CODE.EOF);
        return;
      }

      const bufferToSend = Buffer.alloc(len);
      const filePiece = await fs.read(handle.fileDescriptor, bufferToSend, 0, len, offset);
      session.data(reqId, filePiece.buffer.subarray(0, filePiece.bytesRead));
    });
    session.on('WRITE', async (reqId: number, handleID: Buffer, offset: number, data: Buffer) => {
      const handle = _handles[`H${handleID}`];
      this.#printWarning(
        `Session - WRITE was invoked (ID: ${reqId} ; Handle: ${handleID} ; Path: ${handle.path} ; Offset: ${offset})`,
      );

      fs.write(handle.fileDescriptor, data, 0, data.length, offset);
      session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
      return;
    });
    session.on('FSETSTAT', (reqId: number, handle: Buffer, attrs: ssh2.Attributes) => {
      this.#printWarning(`Session - FSETSTAT was invoked (ID: ${reqId} ; Atributes: ${JSON.stringify(attrs)})`);
    });
    session.on('READLINK', (reqId: number, path: string) => {
      this.#printWarning(`Session - READLINK was invoked (ID: ${reqId} ; Path: ${path})`);
    });
    session.on('SETSTAT', (reqId: number, path: string, attrs: ssh2.Attributes) => {
      this.#printWarning(
        `Session - SETSTAT was invoked (ID: ${reqId} ; Path: ${path} ; Atributes: ${JSON.stringify(attrs)})`,
      );

      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
        path,
        atributes: {
          lastAccessTimestamp: attrs.atime,
          lastModifiedTimestamp: attrs.mtime,
        },
      };
      let res = {
        allow: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.OK);
          return;
        },
        fail: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.FAILURE);
          return;
        },
        deny: () => {
          session.status(reqId, ssh2.utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'SETSTAT');
    });
    session.on('SYMLINK', (reqId: number, targetPath: string, linkPath: string) => {
      this.#printWarning(
        `Session - MKDIR was invoked (ID: ${reqId} ; Target Path: ${targetPath} ; Link Path: ${linkPath})`,
      );
    });
    session.on('EXTENDED', (reqId: number, extName: string, extData: Buffer) => {
      this.#printWarning(`Session - MKDIR was invoked (ID: ${reqId} ; Ext Name: ${extName} ; Ext Data: ${extData})`);
    });
  }

  #handleClient(_this: SFTPServer, remoteInfo: RemoteInfo, client: ssh2.Connection, info: ssh2.ClientInfo) {
    this.#printWarning(`${remoteInfo.ip} was authorized to connect to this server`);

    let username: string | undefined;

    client.on('close', () => {
      client.end();
    });
    // On Error
    client.on('error', (err: Error) => {
      this.#printError(err);
      return _this.emit('error', err);
    });
    // On Authentication
    client.on('authentication', (ctx: ssh2.AuthContext) => {
      this.#printWarning(`Authentication is in progress... (method '${ctx.method}')`);

      // If authentication method is not accepted
      if (!_this.#authMethods.includes(ctx.method)) {
        this.#printError(
          `Rejected authentication for username '${ctx.username}' (method '${ctx.method}' is not accepted)`,
        );
        ctx.reject(this.#authMethods, false);
        return;
      }
      // Is Auth Event defined? If not return error
      let receivedParams: {
        username: string;
        password?: string;
      } = {
        username: ctx.username,
      };
      if (ctx.method === 'password') receivedParams.password = ctx.password;

      let req = {
        ...remoteInfo,
        method: ctx.method,
        credentials: receivedParams,
      };
      let res = {
        allow: (customUsername?: string) => {
          username = customUsername? customUsername : receivedParams.username;
          ctx.accept();
          return;
        },
        deny: () => {
          ctx.reject(_this.#authMethods, false);
          return;
        },
      };

      this.#executeMidleware(req, res, _this, 'Auth');
    });
    // On Client requesting sftp session
    client.on('session', (accept: ssh2.AcceptConnection<ssh2.Session>, reject: ssh2.RejectConnection) => {
      let session = accept();
      session.on('sftp', (accept: ssh2.AcceptSftpConnection, reject: ssh2.RejectConnection) => {
        if (username === undefined) throw new Error('Cannot fetch user username: It is undefined');

        _this.#handleSFTPSession(_this, remoteInfo, client, info, accept(), username);
      });
    });

    client.on('close', () => {
      console.log('Disconected:', username);
      let req = {
        ...remoteInfo,
        credentials: {
          username,
        },
      };
      this.#executeMidleware(req, {}, _this, 'DISCONNECT');
    });
  }

  listen(__callback: (port: number) => void) {
    this.#server.listen(this.#port);
    __callback(this.#port);
    return;
  }
}
