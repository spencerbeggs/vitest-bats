FROM node:24-bookworm

ARG TZ
ENV TZ="$TZ"

ARG PNPM_VERSION=10.33.0
ARG BIOME_VERSION=2.4.9

# Install development tools, firewall dependencies, and kcov build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  bash \
  curl \
  wget \
  binutils \
  libdw-dev \
  libiberty-dev \
  libcurl4-openssl-dev \
  zlib1g-dev \
  python3 \
  cmake \
  pkg-config \
  locales \
  build-essential \
  file \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && ln -sf /bin/bash /bin/sh \
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Install kcov from source (required for bash coverage collection)
ARG KCOV_VERSION=v43
RUN cd /tmp && \
  git clone --depth 1 --branch ${KCOV_VERSION} https://github.com/SimonKagstrom/kcov.git && \
  cd kcov && \
  mkdir build && \
  cd build && \
  cmake .. && \
  make && \
  make install && \
  cd / && \
  rm -rf /tmp/kcov

# Install BATS (Bash Automated Testing System)
ARG BATS_VERSION=v1.13.0
RUN cd /tmp && \
  git clone --depth 1 --branch ${BATS_VERSION} https://github.com/bats-core/bats-core.git && \
  cd bats-core && \
  ./install.sh /usr/local && \
  cd / && \
  rm -rf /tmp/bats-core

# Install bats-support library
ARG BATS_SUPPORT_VERSION=v0.3.0
RUN mkdir -p /usr/local/lib && \
  cd /tmp && \
  git clone --depth 1 --branch ${BATS_SUPPORT_VERSION} https://github.com/bats-core/bats-support.git && \
  cp -r bats-support /usr/local/lib/ && \
  rm -rf /tmp/bats-support

# Install bats-assert library
ARG BATS_ASSERT_VERSION=v2.2.4
RUN mkdir -p /usr/local/lib && \
  cd /tmp && \
  git clone --depth 1 --branch ${BATS_ASSERT_VERSION} https://github.com/bats-core/bats-assert.git && \
  cp -r bats-assert /usr/local/lib/ && \
  rm -rf /tmp/bats-assert

# Install bats-mock for command mocking (no release tags, pin to commit)
ARG BATS_MOCK_COMMIT=2bf74218
RUN mkdir -p /usr/local/lib/bats-mock && \
  cd /tmp && \
  git clone https://github.com/jasonkarns/bats-mock.git && \
  cd bats-mock && git checkout ${BATS_MOCK_COMMIT} && cd /tmp && \
  cp bats-mock/stub.bash bats-mock/binstub /usr/local/lib/bats-mock/ && \
  chmod +x /usr/local/lib/bats-mock/binstub && \
  echo 'source "$(dirname "${BASH_SOURCE[0]}")/stub.bash"' > /usr/local/lib/bats-mock/load.bash && \
  rm -rf /tmp/bats-mock

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist shell history
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

ENV DEVCONTAINER=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Create config, pnpm store, and vscode-server directories
RUN mkdir -p /home/node/.claude /home/node/.local/share/pnpm /home/node/.vscode-server && \
  chown -R node:node /home/node/.claude /home/node/.local/share/pnpm /home/node/.vscode-server

# Pre-create node_modules directories owned by node so volume mounts inherit correct permissions
# Note: paths match the volume mounts in devcontainer.json (hardcoded to repo name)
RUN mkdir -p /workspaces/vitest-bats/node_modules /workspaces/vitest-bats/package/node_modules && \
  chown -R node:node /workspaces/vitest-bats

WORKDIR /workspaces

# Install git-delta for better diffs
ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Switch to non-root user
USER node

ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin
ENV SHELL=/bin/zsh
ENV EDITOR=nano
ENV VISUAL=nano

# Install zsh with plugins
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install Homebrew: create target dir as root, install as node user
USER root
RUN mkdir -p /home/linuxbrew && chown -R node:node /home/linuxbrew
USER node
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:$PATH"

# Install Claude Code via Homebrew
RUN brew install claude-code

# Install Biome binary (pinned version for LSP support)
USER root
RUN ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in \
    amd64) BIOME_ARCH="linux-x64" ;; \
    arm64) BIOME_ARCH="linux-arm64" ;; \
    *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
  esac && \
  curl -fsSL "https://github.com/biomejs/biome/releases/download/%40biomejs%2Fbiome%40${BIOME_VERSION}/biome-${BIOME_ARCH}" -o /usr/local/bin/biome && \
  chmod +x /usr/local/bin/biome
USER node

# Copy and set up firewall script
COPY init-firewall.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node

CMD ["sleep", "infinity"]
