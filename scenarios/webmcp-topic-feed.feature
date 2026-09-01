@playwright @webmcp
Feature: Build a topic feed through WebMCP
  A browser agent should progressively discover only valid actions
  and should update the same trusted workspace and visible UI as a person.

  Background:
    Given the adaptive feed experiment is disabled
    And the page is open in a WebMCP-capable host
    And GitHub recognizes the topics "css" and "typescript"

  @webmcp_001 @manual
  Scenario: Build a complete topic feed with progressive tool discovery
    Then the active WebMCP tools are "choose-feed-source" and "read-feed-workspace"
    When the host calls "choose-feed-source" with source "topics"
    Then the visible builder asks the user to choose topics
    And "set-topics" is an active WebMCP tool
    And "set-feed-settings" is not an active WebMCP tool
    When the host calls "set-topics" with "css" and "typescript"
    Then both topics are visible in the selected topics list
    And the visible builder asks the user to configure the feed
    And "set-feed-settings" is an active WebMCP tool
    And "generate-feed-url" is not an active WebMCP tool
    When the host sets activity to "all" and the update frequency to 86400 seconds
    Then the matching activity and update frequency controls are selected
    And "generate-feed-url" is an active WebMCP tool
    When the host calls "generate-feed-url"
    Then the generated feed URL is visible in the builder
    And the decoded feed configuration is:
      | source        | topics        | topicOperator | activityType | ttl   | format |
      | topics        | css,typescript | or            | all          | 86400 | atom   |
    And the workspace state is "ready"
    And no request was made to "/api/assistant/turn"
    And obsolete WebMCP registrations were aborted

  @webmcp_002 @manual @regression
  Scenario: Reject an unknown topic without advancing the workspace
    When the host calls "choose-feed-source" with source "topics"
    And GitHub does not recognize the topic "not-a-real-topic"
    And the host calls "set-topics" with "not-a-real-topic"
    Then the tool result has error code "unknown-topics"
    And the tool result identifies "not-a-real-topic" as invalid
    And the visible builder has no selected topic
    And the workspace remains in the topic selection state
    And "set-feed-settings" is not an active WebMCP tool
    And no feed URL is visible

  @webmcp_003 @regression
  Scenario: Refuse a stale tool invocation after the source changes
    Given a complete topic draft has made "generate-feed-url" active
    And the host retained that registered tool reference
    When the user starts over in the visible application
    And the host invokes the retained "generate-feed-url" reference
    Then the tool result has error code "invalid-state"
    And the workspace has no feed URL
    And no feed URL is visible

  @webmcp_004 @regression
  Scenario: Manual completion supersedes a slow WebMCP topic selection
    When the host calls "choose-feed-source" with source "topics"
    And the host starts validating the topic "css" but GitHub responds slowly
    And the user selects the different topic "typescript" in the visible builder
    And the user selects an update frequency and generates the feed URL
    And GitHub eventually responds to the superseded "css" validation
    Then the superseded tool result has error code "stale-workspace"
    And the selected topics list contains "typescript" and not "css"
    And the generated feed URL remains visible for "typescript"
