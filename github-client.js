const { getOctokit } = require("@actions/github");
const { shallowFlatten } = require("./utils");

/**
 * @param  {string} token Github personal access token
 * @param  {string} owner The owner of the repository
 * @param  {string} repo Repository name
 * @return {SimpleGithubClient} A client containing `getWorkflowRun`, `getPRAndChecksDetails`, and `createComment`.
 * @description Simplifies needing to call the various `client` functions within the main `index` function of the
 *              action. It mainly abstracts away having to provide `owner` and `repo` to all of the `client.rest`
 *              functions used, and abstracts the complexity of the GraphQL query.
 * @example const { getWorkflowRun, getPRAndChecksDetails, createComment } = createClient(token, owner, repo);
 */
module.exports = function createSimpleGithubClient(token, owner, repo) {
  const githubClient = getOctokit(token);

  return {
    /**
     * @param  {string} runId The workflow run ID
     * @return {WorkflowRun} An object containing the status, conclusion, and an array of pull request objects that
     *                       just has `number`.
     * @example const { status, conclusion, pullRequests } = await client.getWorkflowRun(runId);
     */
    getWorkflowRun: async function getWorkflowRun(runId) {
      const { data } = await githubClient.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });

      return {
        status: data.status,
        conclusion: data.conclusion,
        pullRequests: data.pull_requests.map((pr) => ({
          number: pr.number,
        })),
      };
    },

    /**
     * @param  {string} prNumber The pull request number
     * @return {PRAndChecksDetails} An object containing the PR creator username and type, and the status of all checks
     *                              of the most recent commit in the PR.
     * @description For the provided PR number, the creator's username and type (generally User or Bot), and all of the available
     *              checks data for the latest commit, is returned. This query assumes that the latest commit is the relevant one.
     */
    getPRAndChecksDetails: async function getPRAndChecksDetails(prNumber) {
      const query = `
        query getLatestCheckStatus($repo: String!, $owner: String!, $prNumber: Int!) {
          repository(name: $repo, owner: $owner) {
            pullRequest(number: $prNumber) {
              author {
                login
                __typename
              }
              commits(last: 1) {
                nodes {
                  commit {
                    checkSuites(last: 100) {
                      nodes {
                        checkRuns(last: 100) {
                          nodes {
                            name
                            conclusion
                            status
                          }
                        }
                      }
                    }
                  }
                }
              }
            } 
          }
        }`;

      const queryVars = {
        repo,
        owner,
        prNumber,
      };

      const {
        repository: {
          pullRequest: {
            author,
            commits: { nodes: commitNodes },
          },
        },
      } = await githubClient.graphql(query, queryVars);

      const checks = shallowFlatten(
        commitNodes[0].commit.checkSuites.nodes.map(
          (node) => node.checkRuns.nodes
        )
      );

      return {
        prCreatorUsername: author.login,
        prCreatorType: author.__typename,
        checks,
      };
    },

    /**
     * @param  {string} prNumber
     * @param  {string} body The comment body
     * @return {true} Returns true if comment creation was successful, or throws otherwise.
     */
    createComment: async function createComment(prNumber, body) {
      await githubClient.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });

      return true;
    },
  };
};