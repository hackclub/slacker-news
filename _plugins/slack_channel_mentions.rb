# frozen_string_literal: true

# linkerizes Slack channels: "#eps-conduit" but not "##eps-conduit"
module SlackChannelMentions
  class << self
    CHANNEL_REGEX = /##([\w-]+)|\B#([\w-]+)/
    SLACK_BASE_URL = "https://hackclub.slack.com/archives" # this works without channel lookup, somehow!

    def link_em_up!(html)
      html.gsub!(/>([^<]+)</) do
        text = $1
        linked = text.gsub(CHANNEL_REGEX) do
          if $1
            "##{$1}" # escaped: drop one #, don't link
          else
            %(<a href="#{SLACK_BASE_URL}/#{$2}" class="slack_channel" target="_blank">##{$2}</a>)
          end
        end
        ">#{linked}<"
      end
    end
  end
end

Jekyll::Hooks.register :documents, :post_render do |doc|
  SlackChannelMentions.link_em_up!(doc.output) if doc.write?
end