// Metro, taught about the monorepo (CONVENTIONS.md §2 — one npm install at the
// root, workspace packages referenced as `@aobplatform/domain": "*"`).
//
// Two settings, both required. Without `watchFolders` Metro refuses to resolve
// a file outside the app directory, so `@aobplatform/domain` — the package
// that holds MIN_AGE_SELF_ASSIGN and the approved identifier set — cannot be
// imported at all. Without `nodeModulesPaths` Metro finds the hoisted copy of
// react twice and the bundle dies on two Reacts in one tree.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
