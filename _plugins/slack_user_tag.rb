# frozen_string_literal: true

# use like so: {% slack_user UDK5M9Y13, cwalker %} => @cwalker, but nicely linked
module SlackUserTag
  SLACK_BASE_URL = "https://hackclub.slack.com/team"

  class Tag < Liquid::Tag
    def initialize(tag_name, markup, tokens)
      super
      parts = markup.split(",", 2).map(&:strip)
      @id   = parts[0]
      @name = parts[1]
    end

    def render(_ctx) = %[<a href="#{SLACK_BASE_URL}/#{@id}" class="slack_user" target="_blank">@#{@name}</a>]
  end
end

Liquid::Template.register_tag("slack_user", SlackUserTag::Tag)
