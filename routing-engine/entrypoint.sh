#!/usr/bin/env sh
set -eu

exec java ${JAVA_OPTS:--Xms256m -Xmx1g} \
  -jar /opt/graphhopper/graphhopper-web.jar \
  server /opt/graphhopper/config.yml
