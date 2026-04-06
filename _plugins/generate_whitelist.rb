# frozen_string_literal: true

# Generates whitelist.txt for the auth proxy.
# Posts with `public: true` in frontmatter bypass the login wall.
Jekyll::Hooks.register :site, :post_write do |site|
  paths = %w[
    /
    /login
    /callback
    /logout
    /robots.txt
    /favicon.ico
    /feed.xml
  ]

  site.static_files.each do |f|
    paths << f.url if f.url.end_with?(".svg")
  end

  site.posts.docs.each do |post|
    paths << post.url if post.data["public"]
  end

  File.write(File.join(site.dest, "whitelist.txt"), paths.join("\n"))
end
