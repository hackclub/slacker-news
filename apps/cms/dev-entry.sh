#!/bin/sh
# Run next dev and pipe "y" to handle the schema push prompt
printf "y\n" | cross-env NODE_OPTIONS=--no-deprecation next dev --webpack
