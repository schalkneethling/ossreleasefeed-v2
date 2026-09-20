Feature: Refine a topic feed across conversation and trusted controls
  A user should be able to move between concise conversational results
  and editable controls without stale responses or URLs winning races.

  Background:
    Given the adaptive feed experiment is enabled
    And the user has selected "Ask for a feed"

  @adaptive_topic_001 @manual @playwright @regression
  Scenario: Show and hide controls for a completed topic feed
    When the user asks for a CSS and JavaScript feed updated every 24 hours
    And the assistant returns a complete validated topic feed
    Then the feed recipe and permanent URL are visible
    And the update frequency control is not visible
    When the user sends "Show UI"
    Then the topic and feed setting controls are visible
    And the update frequency is 86400 seconds
    And the previous recipe and URL summary are not visible
    When the user sends "Hide UI"
    Then the topic and feed setting controls are not visible
    And the feed recipe and permanent URL are visible again
    And the assistant confirms that the interface is hidden

  @adaptive_topic_002 @manual @playwright @worker
  Scenario: Revise the current feed configuration and generate a new URL
    Given the current feed-building session contains a completed CSS configuration and displays generated URL "first-token"
    When the user asks to change the current feed to TypeScript and update every 24 hours
    Then the assistant request contains the validated current CSS configuration
    And the assistant request does not contain conversation history
    When the assistant returns a validated TypeScript configuration with newly generated URL "second-token"
    Then URL "first-token" is no longer shown in the current feed-building session
    And URL "second-token" is shown in the current feed-building session
    And the current validated configuration uses only TypeScript and updates every 24 hours

  @adaptive_topic_003 @playwright @regression
  Scenario: Ignore a delayed assistant response after the user changes a visible control
    Given the visible controls contain the validated CSS topic
    And an assistant request to change the feed is pending
    When the user selects the JavaScript topic before the response completes
    And the delayed response proposes a TypeScript feed with URL "stale-token"
    Then the JavaScript selection remains active
    And the delayed assistant message is not added to the conversation
    And URL "stale-token" is not visible
    And the unsent composer text is preserved

  @adaptive_topic_004 @manual @playwright
  Scenario: Answer a follow-up with a suggested reply
    When the user asks for a CSS feed without naming an update frequency
    And the assistant asks how often the feed should update and suggests the replies "1 hour", "6 hours", "24 hours", and "1 week"
    Then a group labelled "Suggested replies" is shown under the latest assistant message
    And the group contains one button for each suggested reply in the given order
    When the user chooses the suggested reply "24 hours"
    Then the assistant request message is exactly "24 hours"
    And the suggested replies are not shown while the request is pending
    When the assistant returns a complete validated topic feed and suggests the reply "Start over"
    Then "24 hours" is shown in the conversation as the user's message
    And the message field is empty
    And only the suggested reply "Start over" is shown
    When the user selects "Guide me"
    Then no suggested replies are shown
    When the user selects "Ask for a feed" again
    Then no suggested replies are shown
