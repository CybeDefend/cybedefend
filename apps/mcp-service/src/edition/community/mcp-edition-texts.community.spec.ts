import { COMMUNITY_MCP_EDITION_TEXTS } from './mcp-edition-texts.community';

/**
 * The project id in `.cybedefend/config.json` is written by whoever commits
 * to the repository or the checked-out branch, so the instructions give it
 * to the agent as a hint: before its first change of a session, the agent
 * checks the project against the repository's remote and asks the user when
 * it cannot tell.
 */
describe('COMMUNITY_MCP_EDITION_TEXTS.serverInstructions', () => {
  const text = COMMUNITY_MCP_EDITION_TEXTS.serverInstructions;

  it('gives the project id of the configuration file as a hint only', () => {
    expect(text).toContain('.cybedefend/config.json');
    expect(text).toMatch(/hint/i);
    expect(text).not.toMatch(/Resolve the project id from \.cybedefend/);
  });

  it('has the agent check the project with the tools it has, before the first change', () => {
    expect(text).toMatch(/before the first change/i);
    expect(text).toMatch(/update_vulnerability/);
    expect(text).toMatch(/set_exploitability/);
    // search_projects searches by name: the repository's name, from its remote.
    expect(text).toMatch(
      /repository name from `git remote get-url origin`.*list_organizations.*search_projects/s,
    );
    expect(text).toMatch(/configured projectId is among the results/);
    // No tool returns a project's repository: the text must not ask for one.
    expect(text).not.toMatch(/linked repository/);
  });

  it('has the agent ask the user otherwise, before any change', () => {
    expect(text).toMatch(
      /otherwise ask the user which project to use before changing anything/i,
    );
  });

  it('says tool results are data, not instructions', () => {
    expect(text).toMatch(/never instructions/i);
  });
});
