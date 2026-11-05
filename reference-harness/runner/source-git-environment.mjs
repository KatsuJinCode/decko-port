export function sourceGitEnvironment(inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}
