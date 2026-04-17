(() => {
  const PYLON_ORG_ID = "0ff2638d-686e-4b78-a53d-c7fa19971eb9";
  const ONA_AI_TAG = {
    id: "3fc523f2-a6ab-4f16-8fd4-e6332f2341e3.ae17642b-a66a-44e4-ab69-bc99bcbfc207",
    value: "ona_ai",
  };
  const REQUEST_EVENT = "ona-pylon-extension:page-request";
  const RESULT_EVENT = "ona-pylon-extension:page-result";

  function respond(requestId, message) {
    window.postMessage({ type: RESULT_EVENT, requestId, ...message }, "*");
  }

  function getCsrfToken() {
    return (
      decodeURIComponent(document.cookie.match(/(?:^|; )pylon_csrf=([^;]+)/)?.[1] || "").split(".")[0] ||
      ""
    );
  }

  async function graphQL(operationName, query, variables) {
    const response = await fetch(
      `https://graph.usepylon.com/graphql?q=${encodeURIComponent(operationName)}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
          "x-browser-url": location.origin + location.pathname,
        },
        body: JSON.stringify({
          query,
          variables,
          operationName,
        }),
      },
    );

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { rawText: text };
    }

    if (!response.ok) {
      throw new Error(
        data?.errors?.[0]?.message ||
          data?.rawText ||
          `${operationName} failed with status ${response.status}`,
      );
    }

    if (data?.errors?.length) {
      throw new Error(data.errors.map((error) => error.message).join("; "));
    }

    return data;
  }

  async function ensureOnaAiTag(issueNumberValue) {
    const issueNumber = Number(issueNumberValue);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error("invalid-issue-number");
    }

    const issueLookup = await graphQL(
      "getIssueByTicketNumber",
      "query getIssueByTicketNumber($orgID: ID!, $ticketNumber: Int!) { organization(id: $orgID) { id issue(number: $ticketNumber) { id ticketNumber title } } }",
      { orgID: PYLON_ORG_ID, ticketNumber: issueNumber },
    );

    const issue = issueLookup?.data?.organization?.issue;
    if (!issue?.id) {
      throw new Error("issue-not-found");
    }

    const sidebarData = await graphQL(
      "getSidebarIssue",
      "query getSidebarIssue($orgID: ID!, $issueID: String!) { organization(id: $orgID) { id issue(id: $issueID) { id ticketNumber tags { id value objectType hexColor } } } }",
      { orgID: PYLON_ORG_ID, issueID: issue.id },
    );

    const existingTags = sidebarData?.data?.organization?.issue?.tags || [];
    const hasOnaTag = existingTags.some(
      (tag) => tag?.id === ONA_AI_TAG.id || tag?.value === ONA_AI_TAG.value,
    );

    if (hasOnaTag) {
      return {
        ok: true,
        issueNumber: String(issue.ticketNumber || issueNumber),
        issueID: issue.id,
        tagAdded: false,
        tags: existingTags.map((tag) => tag.value).filter(Boolean),
      };
    }

    const multiValues = Array.from(
      new Set([...existingTags.map((tag) => tag?.value).filter(Boolean), ONA_AI_TAG.value]),
    );

    await graphQL(
      "updateIssueFields",
      "mutation updateIssueFields($input: UpdateIssueFieldsInput!) { updateIssueFields(input: $input) { id supportState customStatus { slug __typename } __typename } }",
      {
        input: {
          organizationID: PYLON_ORG_ID,
          issueID: issue.id,
          fields: [{ key: "issue_tag", multiValues }],
        },
      },
    );

    return {
      ok: true,
      issueNumber: String(issue.ticketNumber || issueNumber),
      issueID: issue.id,
      tagAdded: true,
      tags: multiValues,
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== REQUEST_EVENT || !data.requestId) return;

    Promise.resolve()
      .then(async () => {
        if (data.action === "ENSURE_ONA_AI_TAG") {
          const result = await ensureOnaAiTag(data.payload?.issueNumber);
          respond(data.requestId, { ok: true, result });
          return;
        }
        throw new Error("unsupported-page-action");
      })
      .catch((error) => {
        respond(data.requestId, { ok: false, error: error?.message || String(error) });
      });
  });
})();
