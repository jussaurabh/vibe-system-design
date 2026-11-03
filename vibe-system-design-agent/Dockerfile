FROM langchain/langgraph-api:3.11

ADD . /deps/vibe-system-design-agent

RUN for dep in /deps/*; do \
        echo "Installing $dep"; \
        if [ -d "$dep" ]; then \
            (cd "$dep" && PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir -c /api/constraints.txt -e .); \
        fi; \
    done

ENV LANGSERVE_GRAPHS='{"agent": "/deps/vibe-system-design-agent/src/vibe_system_design_agent/agent.py:agent"}'

RUN mkdir -p /api/langgraph_api /api/langgraph_runtime /api/langgraph_license && \
    touch /api/langgraph_api/__init__.py /api/langgraph_runtime/__init__.py /api/langgraph_license/__init__.py

RUN PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir --no-deps -e /api

RUN pip uninstall -y pip setuptools wheel && \
    rm -rf /usr/local/lib/python*/site-packages/pip* /usr/local/lib/python*/site-packages/setuptools* /usr/local/lib/python*/site-packages/wheel* && \
    find /usr/local/bin -name "pip*" -delete || true && \
    rm -rf /usr/lib/python*/site-packages/pip* /usr/lib/python*/site-packages/setuptools* /usr/lib/python*/site-packages/wheel* && \
    find /usr/bin -name "pip*" -delete || true && \
    uv pip uninstall --system pip setuptools wheel && \
    rm /usr/bin/uv /usr/bin/uvx || true

WORKDIR /deps/vibe-system-design-agent
