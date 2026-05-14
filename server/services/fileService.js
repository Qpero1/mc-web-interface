/**
 * server/services/fileService.js
 * --------------------------------------------------------------------------
 * File browsing operations — delegates all I/O to localExecutor.
 * --------------------------------------------------------------------------
 */
import { emit, EVENTS } from '../events/emitter.js';

/** List a directory. */
export async function list(ctx, serverId, relative = '/') {
  return ctx.executor.listDirectory(serverId, relative);
}

/** Read a file's contents (text). */
export async function read(ctx, serverId, relative) {
  return ctx.executor.readFile(serverId, relative);
}

/** Write/overwrite a file's contents. */
export async function write(ctx, serverId, relative, content) {
  const res = await ctx.executor.writeFile(serverId, relative, content);
  if (res.success) emit(EVENTS.FILE_CHANGED, { serverId, path: relative });
  return res;
}

/** Delete file or recursive dir. */
export async function remove(ctx, serverId, relative) {
  const res = await ctx.executor.deleteFile(serverId, relative);
  if (res.success) emit(EVENTS.FILE_CHANGED, { serverId, path: relative, removed: true });
  return res;
}

/** Rename / move. */
export async function rename(ctx, serverId, from, to) {
  const res = await ctx.executor.renameFile(serverId, from, to);
  if (res.success) emit(EVENTS.FILE_CHANGED, { serverId, from, to });
  return res;
}

/** Recursive mkdir. */
export async function mkdir(ctx, serverId, relative) {
  return ctx.executor.mkdir(serverId, relative);
}
