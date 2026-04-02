# frozen_string_literal: true

# use like so: {% slack_user cwalker, UDK5M9Y13 %} => @cwalker, but nicely linked
module SlackUserTag
  SLACK_BASE_URL = "https://hackclub.slack.com/team"

  class Tag < Liquid::Tag
    def initialize(tag_name, markup, tokens)
      super
      @name, _, @id = markup.rpartition(",").map(&:strip)
    end

    def render(_ctx) = %[<a href="#{SLACK_BASE_URL}/#{@id}" class="slack_user" target="_blank">@#{@name}</a>]
  end
end

Liquid::Template.register_tag("slack_user", SlackUserTag::Tag)
