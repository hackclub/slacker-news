FROM ruby:3.4.4 AS builder
RUN apt-get update -qq && apt-get install -y build-essential nodejs
WORKDIR /srv/jekyll
COPY Gemfile Gemfile.lock ./
RUN gem install bundler:2.3.7 && bundle install
COPY . .
RUN chown 1000:1000 -R /srv/jekyll
RUN bundle exec jekyll build -d /srv/jekyll/_site

FROM oven/bun:1 AS runtime
WORKDIR /app
COPY proxy/package.json proxy/bun.lock* ./
RUN bun install --frozen-lockfile
COPY proxy/server.ts proxy/tsconfig.json proxy/login.html proxy/logo.svg proxy/whitelist.txt ./
COPY --from=builder /srv/jekyll/_site ./dist
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "server.ts"]