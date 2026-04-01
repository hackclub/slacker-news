# frozen_string_literal: true

module SlackChannelMentions
  class << self
    CHANNEL_REGEX = /(?<!\\)\B#([\w-]+)/ # "#eps-conduit" but not "\#eps-conduit"
    SLACK_BASE_URL = "https://hackclub.slack.com/archives" # this works without channel lookup, somehow!

    def link_em_up!(html)
      html.gsub!(/>([^<]+)</) do
        text = $1
        linked = text.gsub(CHANNEL_REGEX) do
          channel = $1
          %(<a href="#{SLACK_BASE_URL}/#{channel}" class="slack_channel" target="_blank">#{$&}</a>)
        end
        ">#{linked}<"
      end
    end
  end
end

Jekyll::Hooks.register :documents, :post_render do |doc|
  SlackChannelMentions.link_em_up!(doc.output) if doc.write?
end