const fs = require("node:fs/promises");
const path = require("node:path");
const { dataRoot } = require("./runtime-paths");
const { storageMode, readPostsBlob, writePostsBlob } = require("./blob-storage");

const dataDir = dataRoot();
const postsFile = path.join(dataDir, "posts.json");

async function ensureStore() {
  if (storageMode() === "blob") {
    await readPostsBlob();
    return;
  }
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(postsFile);
  } catch {
    await fs.writeFile(postsFile, "[]\n");
  }
}

async function listPosts() {
  if (storageMode() === "blob") return readPostsBlob();
  await ensureStore();
  return JSON.parse(await fs.readFile(postsFile, "utf8"));
}

async function savePosts(posts) {
  if (storageMode() === "blob") return writePostsBlob(posts);
  await ensureStore();
  const temporary = `${postsFile}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(posts, null, 2)}\n`);
  await fs.rename(temporary, postsFile);
}

async function createPost(post) {
  const posts = await listPosts();
  posts.unshift(post);
  await savePosts(posts);
  return post;
}

async function getPost(id) {
  return (await listPosts()).find((post) => post.id === id) || null;
}

async function updatePost(id, patch) {
  const posts = await listPosts();
  const index = posts.findIndex((post) => post.id === id);
  if (index === -1) return null;
  posts[index] = { ...posts[index], ...patch, updatedAt: new Date().toISOString() };
  await savePosts(posts);
  return posts[index];
}

async function deletePost(id) {
  const posts = await listPosts();
  const post = posts.find((item) => item.id === id);
  if (!post) return null;
  await savePosts(posts.filter((item) => item.id !== id));
  return post;
}

module.exports = { ensureStore, listPosts, createPost, getPost, updatePost, deletePost };
