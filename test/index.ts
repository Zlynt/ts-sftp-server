const path = require('path');
const fs = require('fs-extra');

import SFTPServer from '../src/index';

//#region Auxiliary Methods
// Protect against " ../.. " attacks (that escape our folder that holds server files)
const purifyContentPath = (rootPath: string, reqPath: string) => {
  // Path that client is going to see content is on
  let virtualPath = path.posix.resolve(path.posix.join('/', reqPath));
  // Path where the content is realy at
  let realPath = path.resolve(path.join(rootPath, reqPath));
  return { realPath, virtualPath };
};
//#endregion

let sftpServer = new SFTPServer({
  port: 3000,
  privateKeyFilePath: path.join(process.cwd(), 'test', 'certs', 'privkey.pem'),
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

// Example on how to build a plugin
sftpServer.use((req, res, next) => {
  console.log('Intercepted command:', req.command);
  next();
});

// Check if IP can access this server (in this example we only allow localhost)
sftpServer.on('Connection', (req, res) => {
  // Allow only 127.0.0.1 to connect to this server
  if (req.ip === '::ffff:127.0.0.1') res.send(true);
  else res.send(false);

  return;
});

// User authentication (Username: Demo, Password: demo)
sftpServer.on('Auth', (req, res) => {
  console.log('\n=== AUTHENTICATION REQUEST ===');
  console.log('IP:', req.ip);
  console.log('Method:', req.method);
  console.log('Username:', req.credentials.username);
  console.log('================================\n');

  if (req.credentials.username === 'Demo' && req.credentials.password === 'demo') {
    console.log(`Access granted for user ${req.credentials.username}`);
    res.allow(); // Allow user to login
  } else {
    console.log(`Access denied for user ${req.credentials.username}`);
    res.deny(); // Return password invalid
  }
  return;
});

//#region Implement command behaviour
const serverFolderPath = path.join(process.cwd(), 'test', 'files');

// RENAME - Rename a file/folder inside the server
sftpServer.on('RENAME', (req, res) => {
  // Get current path
  const { realPath: realCurrentPath, virtualPath: virtualCurrentPath } = purifyContentPath(serverFolderPath, req.path);
  // Get new path
  const { realPath: realNewPath, virtualPath: virtualNewPath } = purifyContentPath(serverFolderPath, req.toPath);

  console.log(`[RENAME - '${req.credentials.username}'] ${virtualCurrentPath} -> ${virtualNewPath}`);
  fs.renameSync(realCurrentPath, realNewPath);
  // Allow the change to happen
  res.allow();
  return;
});

// REMOVE - Remove file from the server
sftpServer.on('REMOVE', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[REMOVE - '${req.credentials.username}'] ${virtualPath} (${realPath})`);
  fs.removeSync(realPath);

  // Allow the operation to happen
  res.allow();
  return;
});

// SETSTAT - Change file properties
sftpServer.on('SETSTAT', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[SETSTAT - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  fs.utimesSync(
    realPath,
    parseInt(`${req.atributes.lastAccessTimestamp}`),
    parseInt(`${req.atributes.lastModifiedTimestamp}`),
  );

  // Allow the operation to happen
  res.allow();
  return;
});

// WRITE - Write changes to a file
sftpServer.on('WRITE', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[WRITE - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  // Pass the location where your writen file must be
  res.receiveFile(realPath);
  return;
});

// READ - Read file content
sftpServer.on('READ', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[READ - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  // Pass the location of the file to be read by the client
  res.sendFile(realPath);
  return;
});

// OPENDIR - Client request to open a certain directory
sftpServer.on('OPENDIR', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[OPENDIR - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  // Allow directory to be open
  res.allow();
  return;
});

// RMDIR - Client request to remove a certain directory
sftpServer.on('RMDIR', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[RMDIR - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  fs.removeSync(realPath);

  // Allow directory to be open
  res.allow();
  return;
});

// MKDIR - Client request to create a certain directory
sftpServer.on('MKDIR', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[MKDIR - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  fs.mkdirSync(realPath);

  // Allow directory to be created
  res.allow();
  return;
});

// READDIR - Client request to read list of a directory's contents alongside that content's permissions
sftpServer.on('READDIR', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[READDIR - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  if (!fs.existsSync(realPath) && fs.statSync(realPath).isDirectory() === false) {
    res.notFound();
    return;
  }

  let contentList: any = fs.readdirSync(realPath);
  for (let i = 0; i < contentList.length; i += 1) {
    try {
      let contentInfo = fs.statSync(path.join(realPath, contentList[i]));
      contentList[i] = {
        // Name of the file/directory
        contentName: contentList[i],
        // UNIX owner user ID
        uid: 1000,
        // UNIX owner group ID
        gid: 1000,
        // UNIX timestamp of the last file access date
        lastAccessTimestamp: contentInfo.atime,
        // UNIX timestamp of the last file modification date
        lastModifiedTimestamp: contentInfo.mtime,
        // File/Directory size in bytes
        size: contentInfo.size,
        // 'directory' indicates it is a directory
        // 'file' indicates it is a file
        typeOfContent: contentInfo.isDirectory() ? 'directory' : 'file',
        // UNIX file/directory permissions written in octal
        permissions: 0o644,
      };
    } catch (err) {
      console.log(`[READDIR - '${req.credentials.username}']`, err);
      res.failure();
      return;
    }
  }

  // Send content list (must be an array)
  res.send(contentList);
  return;
});

// CLOSE - Client closing pointer to a certain file/directory
sftpServer.on('CLOSE', (req) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[CLOSE - '${req.credentials.username}'] ${virtualPath} (${realPath})`);
});

// REALPATH - Tell client information related to a path
/*
Returns to the client:
-> Filename
-> Owner UID and GID
-> Last access/modification date
-> Content size
-> Type of content (directory or file)
-> File/Directory access permissions
*/
sftpServer.on('REALPATH', (req, res) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[REALPATH - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  /*
  If we do not pass the permissions to this method, 
  the server will automatically get them from the real file
  and return it to the client
  */
  res.send(realPath, virtualPath);
});

// STAT/LSTAT/FSTAT - Tell client information related to a file/directory
const STAT = (req: any, res: any, operationName: string) => {
  const { realPath, virtualPath } = purifyContentPath(serverFolderPath, req.path);

  console.log(`[${operationName} - '${req.credentials.username}'] ${virtualPath} (${realPath})`);

  // If file/directory does not exist inside server, inform the client
  if (!fs.existsSync(realPath)) return res.notFound();

  let stat = fs.statSync(realPath);
  if (stat.isFile()) {
    return res.sendFile(0o755, 0, 0, stat.size, stat.atimeMs, stat.mtimeMs);
  }
  if (stat.isDirectory()) {
    return res.sendDirectory(0o755, 0, 0, stat.size, stat.atimeMs, stat.mtimeMs);
  }

  // If content is neither a file or a directory, return failure
  return res.failure();
};

sftpServer.on('LSTAT', (req, res) => {
  STAT(req, res, 'LSTAT');
});
sftpServer.on('STAT', (req, res) => {
  STAT(req, res, 'STAT');
});
sftpServer.on('FSTAT', (req, res) => {
  STAT(req, res, 'FSTAT');
});

// On user disconect
sftpServer.on('DISCONNECT', (req) => {
  console.log('User Disconnect:', req.credentials.username);
});
//#endregion

// Start the server on port 3000
sftpServer.listen((port: number) => {
  // Ensure that the folder where all the data is going to be stored exists
  fs.ensureDirSync(serverFolderPath);
  console.log('[SFTP Server]', `Started on port ${port}`);
});
