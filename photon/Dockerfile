FROM eclipse-temurin:21-jre-alpine@sha256:3f08b13888f595cc49edabea7250ba69499ba25602b267da591720769400e08c

WORKDIR /photon

RUN apk add --no-cache curl

ARG PHOTON_VERSION
ARG PHOTON_SHA256

# Keep the runtime JAR reproducible and compatible with the pinned Indonesia
# database dump. Database replacement remains an explicit host-side operation.
RUN test -n "${PHOTON_VERSION}" \
    && test -n "${PHOTON_SHA256}" \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      --output photon.jar \
      "https://github.com/komoot/photon/releases/download/${PHOTON_VERSION}/photon-${PHOTON_VERSION}.jar" \
    && echo "${PHOTON_SHA256}  photon.jar" | sha256sum -c -

EXPOSE 2322

CMD ["java", "-jar", "photon.jar", "-data-dir", "/photon", "-listen-port", "2322", "-listen-ip", "0.0.0.0"]
