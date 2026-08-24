export type ReleaseCommitSource = "build" | "vercel" | "development";

type ReleaseIdentityInput = {
  buildCommitSha?: string;
  vercelCommitSha?: string;
};

const GIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

function normalizeGitSha(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

export function resolveReleaseIdentity({
  buildCommitSha,
  vercelCommitSha,
}: ReleaseIdentityInput): { commitSha: string; commitSource: ReleaseCommitSource } {
  const buildSha = normalizeGitSha(buildCommitSha);
  if (buildSha) {
    return { commitSha: buildSha, commitSource: "build" };
  }

  const vercelSha = normalizeGitSha(vercelCommitSha);
  if (vercelSha) {
    return { commitSha: vercelSha, commitSource: "vercel" };
  }

  return { commitSha: "development", commitSource: "development" };
}
