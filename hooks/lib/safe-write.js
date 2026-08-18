'use strict';

// Symlink-refusing, atomic-rename file write.
//
// Duplicated verbatim in another plugin in this marketplace; mirror any
// functional fix.
//
// Throws on refusal or I/O failure; every call site wraps the call in
// try/catch, so a throw here degrades to the feature silently skipping
// (fail-open), never a broken session.
//
// win32 has no uid, so a symlinked parent dir is trusted only when it
// resolves under tmpdir/homedir (case-insensitive); O_NOFOLLOW degrades to 0
// there too, leaving the lstat checks below as the accepted residual defense
// (accepted win32 TOCTOU tradeoff).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function safeWriteFileSync(target, content) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });

  let realDir = dir;
  const dstat = fs.lstatSync(dir);
  if (dstat.isSymbolicLink()) {
    realDir = fs.realpathSync(dir);
    const rstat = fs.statSync(realDir);
    if (!rstat.isDirectory()) throw new Error('safe-write: dir target not a directory');
    if (typeof process.getuid === 'function') {
      if (rstat.uid !== process.getuid()) throw new Error('safe-write: dir owned by another user');
    } else {
      const roots = [os.tmpdir(), os.homedir()].map((r) => path.win32.resolve(r).toLowerCase() + path.win32.sep);
      const real = path.win32.resolve(realDir).toLowerCase() + path.win32.sep;
      if (!roots.some((r) => real.startsWith(r))) throw new Error('safe-write: dir outside trusted roots');
    }
  }

  const realTarget = path.join(realDir, path.basename(target));
  try {
    if (fs.lstatSync(realTarget).isSymbolicLink()) throw new Error('safe-write: target is a symlink');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const tmpPath = path.join(realDir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
  try {
    fs.writeSync(fd, content);
    try {
      fs.fchmodSync(fd, 0o600);
    } catch {
      /* best-effort; irrelevant on win32 */
    }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmpPath, realTarget);
  } catch (e) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best-effort cleanup */
    }
    throw e;
  }
}

module.exports = { safeWriteFileSync };
