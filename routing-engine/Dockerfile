ARG GRAPH_HOPPER_VERSION=11.0

FROM alpine:3.22 AS download
ARG GRAPH_HOPPER_VERSION
RUN apk add --no-cache ca-certificates curl
RUN curl --fail --location --retry 3 \
      "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/${GRAPH_HOPPER_VERSION}/graphhopper-web-${GRAPH_HOPPER_VERSION}.jar" \
      --output /tmp/graphhopper-web.jar \
    && curl --fail --location --retry 3 \
      "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/${GRAPH_HOPPER_VERSION}/graphhopper-web-${GRAPH_HOPPER_VERSION}.jar.sha1" \
      --output /tmp/graphhopper-web.jar.sha1 \
    && cd /tmp \
    && echo "$(cat graphhopper-web.jar.sha1)  graphhopper-web.jar" | sha1sum -c -

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 graphhopper \
    && mkdir -p /opt/graphhopper /data/graph-cache \
    && chown -R graphhopper:graphhopper /opt/graphhopper /data
COPY --from=download /tmp/graphhopper-web.jar /opt/graphhopper/graphhopper-web.jar
COPY --chown=graphhopper:graphhopper config.yml entrypoint.sh /opt/graphhopper/
RUN chmod 0555 /opt/graphhopper/entrypoint.sh
USER graphhopper
WORKDIR /data
EXPOSE 8989
ENTRYPOINT ["/opt/graphhopper/entrypoint.sh"]
