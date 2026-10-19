import { Kind, OperationDefinitionNode, parse, visit } from "graphql";
import { SIDE_EFFECT_READS_ENV, sideEffectReadsAllowed } from "./sideEffects.js";

const BLOCKED_OPERATION_NAMES = new Set([
  "ParticipantView",
  "ParticipationView",
  "ParticipationOpportunityView",
  "MarkConversationAsSeen",
  "ReadNotification",
  "ReadAll",
  "TrackSessionAttendance",
  "JoinSessionChat",
  "Bookmark",
  "BookmarkParticipation",
  "RemoveBookmark",
  "RemoveBookmarkParticipation",
  "UpdateViewerPreferredLanguage",
  "ToggleMessagingV2",
  "RequestConfirmEmail"
]);

const AUTH_MUTATION_NAMES = new Set([
  "LogIn",
  "RequestMagicLoginToken",
  "ConfirmMagicLogin"
]);

export class UnsafeGraphQLOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeGraphQLOperationError";
  }
}

export interface ReadOnlyValidationOptions {
  allowAuthMutations?: boolean;
}

export function assertReadOnlyGraphQL(
  documentText: string,
  options: ReadOnlyValidationOptions = {}
): void {
  const document = parse(documentText);

  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) {
      continue;
    }

    const operation = definition as OperationDefinitionNode;
    const operationName = operation.name?.value;

    if (operationName && BLOCKED_OPERATION_NAMES.has(operationName)) {
      throw new UnsafeGraphQLOperationError(
        `Blocked GraphQL operation "${operationName}" is not read-only.`
      );
    }

    if (operation.operation === "query") {
      continue;
    }

    if (
      options.allowAuthMutations &&
      operation.operation === "mutation" &&
      operationName &&
      AUTH_MUTATION_NAMES.has(operationName)
    ) {
      continue;
    }

    throw new UnsafeGraphQLOperationError(
      `Only GraphQL query operations are allowed; got ${operation.operation}.`
    );
  }
}

const SIDE_EFFECT_READ_FIELDS = new Set(["messagesV2", "notifications"]);

export function selectedFieldNames(documentText: string): string[] {
  const names = new Set<string>();
  visit(parse(documentText), {
    Field(node) {
      names.add(node.name.value);
    }
  });
  return [...names];
}

export function assertNoUnacknowledgedSideEffectReads(documentText: string): void {
  if (sideEffectReadsAllowed()) {
    return;
  }

  const selected = new Set(selectedFieldNames(documentText));
  const hits = [...SIDE_EFFECT_READ_FIELDS].filter((name) => selected.has(name));
  if (hits.length === 0) {
    return;
  }

  throw new UnsafeGraphQLOperationError(
    `This query selects ${hits.join(" and ")}, which B2match treats as a read/seen action. Set ${SIDE_EFFECT_READS_ENV}=1 to allow it.`
  );
}
