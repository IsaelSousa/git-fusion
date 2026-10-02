import type { Extension } from "./api";
import { githubActions } from "./github-actions";

/** Extensões que acompanham o GitFusion. */
export const BUILTIN_EXTENSIONS: Extension[] = [githubActions];
