Feature: Build a feed from starred repositories
  Starred-feed journeys should preserve explicit user choices
  and recover safely when information or asynchronous results are incomplete.

  @starred_001 @manual @playwright @worker
  Scenario: Ask for a username when a starred-feed request omits it
    Given the adaptive feed experiment is enabled
    And the user has selected "Ask for a feed"
    When the user asks "Create a feed from my starred repositories"
    Then the assistant asks which GitHub username to use
    And the username control is not visible
    And no feed URL is visible

  @starred_004 @worker @regression
  Scenario: Ignore an unsolicited repository selection before a username is known
    Given the trusted feed draft has no source and no username
    And the model chooses a starred feed and an unsolicited positional repository action
    When the user asks "Create a feed from my starred repositories"
    Then the assistant response status is 200
    And the trusted source is "starred"
    And no repository selection is applied
    And the assistant asks which GitHub username to use
    And GitHub was not queried

  @starred_002 @manual @playwright @worker @regression
  Scenario: Preserve named repositories while asking for the username
    When the user asks for "wrapdotdev/warp" and "mattpocock/skills" from their starred repositories
    And the username is not yet known
    Then both repository names are retained in the trusted draft
    And the assistant asks which GitHub username to use
    When the user replies "schalkneethling"
    Then the username follow-up request contains both retained repository names
    And GitHub validates both repositories against that user's public stars
    And the assistant confirms that 2 repositories are selected

  @starred_003 @manual @playwright @regression
  Scenario: Clear stale repositories while a changed username is debounced
    Given the visible username is "octocat"
    And the repository picker contains "octocat/hello-world"
    When the user changes the username to "next-user"
    Then "octocat/hello-world" is removed immediately
    And repositories for "next-user" have not been requested before the debounce completes
    When the username debounce completes
    Then repositories for "next-user" are requested once
    And the repository picker contains only repositories owned by "next-user"
