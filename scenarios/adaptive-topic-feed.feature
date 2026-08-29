@manual @playwright
Feature: Refine a topic feed across conversation and trusted controls
  A user should be able to move between concise conversational results
  and editable controls without stale responses or URLs winning races.

  Background:
    Given the adaptive feed experiment is enabled
    And the user has selected "Ask for a feed"

  @adaptive_topic_001 @regression
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

  @adaptive_topic_002
  Scenario: Revise the current feed configuration and generate a new URL
    Given the current feed-building session contains a completed CSS configuration and displays generated URL "first-token"
    When the user asks to change the current feed to TypeScript and update every 24 hours
    Then the assistant request contains the validated current CSS configuration
    And the assistant request does not contain conversation history
    When the assistant returns a validated TypeScript configuration with newly generated URL "second-token"
    Then URL "first-token" is no longer shown in the current feed-building session
    And URL "second-token" is shown in the current feed-building session
    And the current validated configuration uses only TypeScript and updates every 24 hours

  @adaptive_topic_003 @regression
  Scenario: Ignore a delayed assistant response after the user changes a visible control
    Given the visible controls contain the validated CSS topic
    And an assistant request to change the feed is pending
    When the user selects the JavaScript topic before the response completes
    And the delayed response proposes a TypeScript feed with URL "stale-token"
    Then the JavaScript selection remains active
    And the delayed assistant message is not added to the conversation
    And URL "stale-token" is not visible
    And the unsent composer text is preserved
