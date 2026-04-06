# Slacker News Proxy

This is the proxy server for Slacker News. It puts an auth layer in front of the server.

Build the static files into /proxy/dist and run `bun i && bun dev`. Or just use Docker, everything should work automatically.

Add paths into whitelist to make them accessible and bypass auth. Files in /assets are also accessible.
