export const EVENT_BY_EUID = /* GraphQL */ `
  query EventByEuid($euid: String!) {
    eventByEuidV2(euid: $euid) {
      __typename
      ... on Event {
        id
        euid
        title
        description
        websiteUrl
        matchmakingMode
        bookingEnabled
        meetingsBeginV2
        meetingsEndV2
        hasGoogleLogin
        hasLinkedInLogin
        shouldOnlyUseMagicLinkLogin
        timeZone {
          id
          name
        }
        time {
          begin
          end
        }
        registration {
          isOpen
          begin
          end
        }
        location {
          city
          venue
          country {
            id
            iso
            name: translatedName(euid: $euid)
          }
        }
        navigation {
          items {
            nodes {
              ... on NavigationLink {
                id
                name
                url
                externalUrl
                shouldOpenInNewTab
              }
              ... on NavigationGroup {
                id
                name
                nodes {
                  nodes {
                    ... on NavigationLink {
                      id
                      name
                      url
                      externalUrl
                      shouldOpenInNewTab
                    }
                  }
                }
              }
            }
          }
        }
      }
      ... on EventNotFoundReason {
        message
      }
      ... on EventArchivedReason {
        message
      }
      ... on InvalidDomainReason {
        eventWebsiteUrl: websiteUrl
      }
    }
  }
`;

export const EVENT_ID_LOOKUP = /* GraphQL */ `
  query EventIdLookup($id: ID!) {
    event(id: $id) {
      id
      euid
    }
  }
`;

export const SOCIAL_LOGIN_URLS = /* GraphQL */ `
  query SocialLoginUrls($euid: String!, $redirectUrl: String!, $invitationCode: String) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        id
        googleLoginURL(redirectUrl: $redirectUrl, invitationCode: $invitationCode)
        linkedInLoginURL(redirectUrl: $redirectUrl, invitationCode: $invitationCode)
      }
    }
  }
`;

export const VIEWER_STATUS = /* GraphQL */ `
  query ViewerStatus {
    viewer {
      id
      firstName
      lastName
      jobPosition
      avatar: avatarUrl
      email
      hasPassword
    }
  }
`;

export const MY_EVENTS = /* GraphQL */ `
  query MyEvents {
    viewer {
      id
      firstName
      lastName
      activeEvents {
        nodes {
          id
          euid
          title
          websiteUrl
          time {
            begin
            end
          }
        }
      }
    }
  }
`;

export const MY_PARTICIPATION = /* GraphQL */ `
  query MyParticipation($euid: String!) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        id
        euid
        title
        matchmakingMode
        bookingEnabled
        meetingsBeginV2
        meetingsEndV2
        viewerCanRequestMeeting {
          value
          reason {
            ... on Reason {
              message
            }
          }
        }
      }
    }
    viewer {
      id
      firstName
      lastName
      participantByEuid(euid: $euid) {
        id
        eid
        state
        isRegistered
        isConfirmed
        isValidated
        hasFinishedRegistration
        participatesInMatchmaking
        remainingRequests
        attendanceType
        availableForMessaging
        profileUrl
        location {
          city
          stateProvince
          country {
            id
            iso
            name: translatedName(euid: $euid)
          }
        }
        timeZone {
          id
          name
        }
        badges {
          pendingMeetings
          unreadConversations
        }
        notificationsCounter {
          unread
          unseen
        }
        representations {
          nodes {
            id
            isOwner
            status
            participation {
              id
              profileUrl(fullUrl: false)
              description
              website
              organisation {
                id
                name
                fullName
              }
              organisationType {
                id
                name: translatedName(euid: $euid)
              }
            }
          }
        }
        opportunities {
          nodes {
            id
            enabled
            published
            opportunity {
              id
              url
              title
              type
              updatedAt
              shortDescription
            }
          }
        }
      }
    }
  }
`;

export const ROUTE_TYPENAME = /* GraphQL */ `
  query RouteTypename($euid: String!, $path: URI!) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        routeByPath(path: $path) {
          __typename
        }
      }
    }
  }
`;

export function buildRouteTypenamesQuery(count: number): string {
  if (count < 1) {
    throw new Error("At least one path is required to probe route types.");
  }

  const variableDecls = Array.from({ length: count }, (_, index) => `$p${index}: URI!`).join(", ");
  const fields = Array.from(
    { length: count },
    (_, index) => `r${index}: routeByPath(path: $p${index}) { __typename }`
  ).join("\n        ");

  return /* GraphQL */ `
  query RouteTypenames($euid: String!, ${variableDecls}) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        ${fields}
      }
    }
  }
`;
}

export function routeTypenameVariables(euid: string, paths: string[]): Record<string, unknown> {
  const variables: Record<string, unknown> = { euid };
  paths.forEach((path, index) => {
    variables[`p${index}`] = path;
  });
  return variables;
}

export const DIRECTORY_ROUTE = /* GraphQL */ `
  query DirectoryRoute(
    $euid: String!
    $path: URI!
    $page: PageInfoInput!
    $participantFilters: GroupedParticipantsFiltersInput
    $participantsGroupedBy: ParticipantsGroupedBy
    $participationFilters: ParticipationFiltersInput
    $opportunityFilters: OpportunityFiltersInput
    $agendaFilters: AgendaFiltersInput!
    $speakersFirst: Int!
    $speakersAfter: String
    $sessionAttendeesFirst: Int!
    $sessionAttendeesAfter: String
    $useClientCache: Boolean = false
  ) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        id
        euid
        routeByPath(path: $path) {
          __typename
          ... on ParticipantsRoute {
            participantsRouteId: id
            name
            url
            groupedParticipants(groupedBy: $participantsGroupedBy) {
              __typename
              ... on ParticipantGroupedParticipants {
                participants(page: $page, filters: $participantFilters, useClientCache: $useClientCache) {
                  totalCount
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                  }
                  nodes {
                    id
                    profileUrl
                    avatar: avatarUrl
                    organisationName
                    about
                    pitch
                    attendanceType
                    isSpeaker
                    isOnline
                    user {
                      id
                      firstName
                      lastName
                      jobPosition
                      avatar: avatarUrl
                    }
                    location {
                      city
                      stateProvince
                      country {
                        id
                        iso
                        name: translatedName(euid: $euid)
                      }
                    }
                    participation {
                      id
                      profileUrl(fullUrl: false)
                      organisation {
                        id
                        name
                        fullName
                      }
                    }
                  }
                }
              }
            }
          }
          ... on ParticipationsRoute {
            participationsRouteId: id
            name
            participationsV2(page: $page, filters: $participationFilters) {
              totalCount
              pageInfo {
                hasNextPage
                hasPreviousPage
                endCursor
              }
              nodes {
                id
                profileUrl(fullUrl: false)
                logoUrl
                description
                shortDescription
                website
                organisation {
                  id
                  name
                  fullName
                }
                organisationType {
                  id
                  name: translatedName(euid: $euid)
                }
                location {
                  city
                  stateProvince
                  country {
                    id
                    iso
                    name: translatedName(euid: $euid)
                  }
                }
              }
            }
          }
          ... on OpportunitiesRoute {
            opportunitiesRouteId: id
            name
            opportunitiesV2(page: $page, filters: $opportunityFilters) {
              totalCount
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
              nodes {
                opportunityId: id
                title
                url
                type
                updatedAt
                shortDescription
                participation {
                  id
                  organisation {
                    id
                    name
                    fullName
                  }
                }
                author {
                  id
                  user {
                    id
                    firstName
                    lastName
                  }
                }
              }
            }
          }
          ... on AgendaRoute {
            agendaRouteId: id
            name
            agenda(filters: $agendaFilters) {
              days {
                nodes {
                  day
                  items {
                    nodes {
                      __typename
                      ... on Session {
                        sessionId: id
                        url
                        title
                        shortDescription
                        format
                        attendanceStatus
                        time {
                          begin
                          end
                        }
                        location {
                          id
                          name
                        }
                        speakers {
                          nodes {
                            id
                            profileUrl
                            organisationName
                            user {
                              id
                              firstName
                              lastName
                              jobPosition
                            }
                          }
                        }
                      }
                      ... on Meeting {
                        meetingId: id
                        status
                        online
                        schedule {
                          begin
                          end
                        }
                      }
                      ... on NetworkingBlock {
                        networkingBlockId: id
                        title
                        shortDescription
                        virtual
                        time {
                          begin
                          end
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          ... on SpeakersRoute {
            speakersRouteId: id
            name
            speakers(first: $speakersFirst, after: $speakersAfter, orderBy: "participant_name") {
              pageInfo {
                hasNextPage
                hasPreviousPage
                endCursor
              }
              nodes {
                id
                profileUrl
                avatar: avatarUrl
                organisationName
                user {
                  id
                  firstName
                  lastName
                  jobPosition
                  avatar: avatarUrl
                }
                participation {
                  id
                  organisation {
                    id
                    name
                    fullName
                  }
                }
              }
            }
          }
          ... on SessionRoute {
            sessionRouteId: id
            name
            session {
              sessionId: id
              url
              title
              shortDescription
              descriptionV2
              format
              time {
                begin
                end
              }
              location {
                id
                name
              }
              speakers {
                nodes {
                  id
                  profileUrl
                  organisationName
                  user {
                    id
                    firstName
                    lastName
                    jobPosition
                  }
                }
              }
              attendees(page: { first: $sessionAttendeesFirst, after: $sessionAttendeesAfter }) {
                count
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  profileUrl
                  organisationName
                  user {
                    id
                    firstName
                    lastName
                    jobPosition
                  }
                }
              }
            }
          }
          ... on ParticipationProfileRoute {
            participationProfileRouteId: id
            name
            participation {
              id
              logoUrl
              profileUrl(fullUrl: false)
              description
              website
              organisation {
                id
                name
                fullName
              }
              organisationType {
                id
                name: translatedName(euid: $euid)
              }
              location {
                city
                stateProvince
                country {
                  id
                  iso
                  name: translatedName(euid: $euid)
                }
              }
              representatives {
                nodes {
                  participant {
                    id
                    profileUrl
                    organisationName
                    user {
                      id
                      firstName
                      lastName
                      jobPosition
                    }
                  }
                }
              }
              opportunities {
                nodes {
                  opportunityId: id
                  title
                  url
                  type
                  shortDescription
                }
              }
            }
          }
          ... on OpportunityRoute {
            opportunityRouteId: id
            name
            opportunity {
              opportunityId: id
              title
              url
              type
              updatedAt
              description
              shortDescription
              participation {
                id
                organisation {
                  id
                  name
                  fullName
                }
              }
              author {
                id
                user {
                  id
                  firstName
                  lastName
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const LIST_PARTICIPANTS = /* GraphQL */ `
  query ListParticipants($eventId: ID!, $euid: String!, $query: String, $first: Int, $after: String) {
    event(id: $eventId) {
      id
      euid
      title
      participants(first: $first, after: $after, query: $query, useClientCache: false) {
        totalCount
        pageInfo {
          hasNextPage
          hasPreviousPage
          endCursor
        }
        nodes {
          id
          profileUrl
          avatar: avatarUrl
          organisationName
          about
          pitch
          attendanceType
          isSpeaker
          isOnline
          user {
            id
            firstName
            lastName
            jobPosition
            avatar: avatarUrl
          }
          location {
            city
            stateProvince
            country {
              id
              iso
              name: translatedName(euid: $euid)
            }
          }
          participation {
            id
            profileUrl(fullUrl: false)
            organisation {
              id
              name
              fullName
            }
          }
        }
      }
    }
  }
`;

export const PARTICIPANT_DETAIL = /* GraphQL */ `
  query ParticipantDetail($euid: String!, $id: ID!) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        id
        euid
        participantV2(id: $id) {
          ... on Participant {
            id
            profileUrl
            avatar: avatarUrl
            about
            pitch
            biography
            organisationName
            eligibleForMatchmaking
            attendanceType
            isSpeaker
            isOnline
            email
            phoneNumber
            linkedInUrl
            facebookUrl
            twitterUrl
            instagramUrl
            user {
              id
              firstName
              lastName
              jobPosition
              avatar: avatarUrl
            }
            location {
              city
              stateProvince
              country {
                id
                iso
                name: translatedName(euid: $euid)
              }
            }
            participation {
              id
              profileUrl(fullUrl: false)
              logoUrl
              description
              website
              organisation {
                id
                name
                fullName
              }
              organisationType {
                id
                name: translatedName(euid: $euid)
              }
            }
            opportunities {
              nodes {
                id
                title
                url
                type
                shortDescription
              }
            }
            speakerSessions {
              nodes {
                day
                sessions {
                  nodes {
                    id
                    url
                    title
                    shortDescription
                    time {
                      begin
                      end
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const MY_SCHEDULE = /* GraphQL */ `
  query MySchedule($euid: String!) {
    viewer {
      id
      firstName
      lastName
      participantByEuid(euid: $euid) {
        id
        shouldShowPendingMeetingsInMySchedule
        pendingMeetingsUrl
        pendingMeetingsCount
        pdfAgendaUrl
        mySchedule {
          days {
            nodes {
              day
              items {
                nodes {
                  __typename
                  ... on Meeting {
                    meetingId: id
                    viewersViewMeetingUrl
                    schedule {
                      begin
                      end
                    }
                    members {
                      nodes {
                        id
                        participant {
                          id
                          avatar: avatarUrl
                          user {
                            id
                            firstName
                            lastName
                            isViewer
                            jobPosition
                            avatar: avatarUrl
                          }
                        }
                      }
                    }
                  }
                  ... on Session {
                    id
                    url
                    title
                    description
                    time {
                      begin
                      end
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const MY_MEETINGS_AND_AVAILABILITY = /* GraphQL */ `
  query MyMeetingsAndAvailability($euid: String!) {
    viewer {
      id
      participantByEuid(euid: $euid) {
        id
        isAvailable
        openNetworkingEnabled
        meetings {
          accepted {
            nodes {
              ...MeetingCard
            }
          }
          receivedInvitations {
            nodes {
              ...MeetingCard
            }
          }
          sentInvitations {
            nodes {
              ...MeetingCard
            }
          }
          canceled {
            nodes {
              ...MeetingCard
            }
          }
        }
        availability {
          viewerShouldSeeAvailabilityButton
          viewerAvailabilityChangesPaused
          viewerAvailabilityLocked
          days {
            nodes {
              date
              blocks {
                nodes {
                  id
                  title
                  virtual
                  timeslots {
                    nodes {
                      id
                      begin
                      end
                      viewerIsRegistered
                      meeting {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  fragment MeetingCard on Meeting {
    id
    status
    online
    description
    viewersViewMeetingUrl
    schedule {
      begin
      end
      location {
        table
        location
      }
    }
    proposedSchedule {
      begin
      end
      location {
        table
        location
      }
    }
    members {
      nodes {
        id
        status
        isHost
        participant {
          id
          profileUrl
          organisationName
          user {
            id
            firstName
            lastName
            jobPosition
            isViewer
          }
        }
      }
    }
  }
`;

export const FIND_MEETING_SLOTS = /* GraphQL */ `
  query DaysAndTimeslot($euid: String!, $participantIds: [ID!]!, $day: Time = "", $duration: MeetingDuration, $meetingId: ID, $isLtm: Boolean! = false) {
    eventByEuidV2(euid: $euid) {
      ... on Event {
        id
        longTermNetworking {
          id
          begin
          end
          day(participantIds: $participantIds, day: $day, duration: $duration, meetingId: $meetingId) @include(if: $isLtm) {
            day
            timeslots {
              nodes {
                ...Slot
              }
            }
          }
        }
        networkingDays(participantIds: $participantIds, meetingId: $meetingId) {
          nodes {
            day
            timeslots {
              nodes {
                ...Slot
              }
            }
          }
        }
      }
    }
    viewer {
      id
      participantByEuid(euid: $euid) {
        id
        recommendedSchedule(participantIds: $participantIds) {
          ... on RecommendedScheduleSuccessPayload {
            day
            timeslotId
            isLtm
          }
          ... on RecommendedScheduleFailurePayload {
            reason {
              ... on Reason {
                message
              }
            }
          }
        }
      }
    }
  }

  fragment Slot on ParticipantsTimeslot {
    id
    begin
    end
    meetingWillBeOnline
    viewerShouldSelectLocation
    isAvailable {
      value
      reasons {
        ... on Reason {
          message
        }
      }
    }
    participants {
      nodes {
        participant {
          id
          user {
            id
            firstName
          }
        }
        isAvailable {
          value
          reasons {
            ... on Reason {
              message
            }
          }
        }
      }
    }
  }
`;

export const RECOMMENDATIONS = /* GraphQL */ `
  query Recommendations($euid: String!) {
    viewer {
      id
      participantByEuid(euid: $euid) {
        id
        recommendedParticipantsV2 {
          nodes {
            id
            recommendationId
            reason
            participant {
              id
              profileUrl
              organisationName
              user {
                id
                firstName
                lastName
                jobPosition
              }
              location {
                city
                country {
                  id
                  iso
                  name: translatedName(euid: $euid)
                }
              }
            }
          }
        }
        newestParticipantsToMeet {
          nodes {
            id
            profileUrl
            organisationName
            user {
              id
              firstName
              lastName
              jobPosition
            }
          }
        }
      }
    }
  }
`;

export const CONVERSATIONS = /* GraphQL */ `
  query Conversations($euid: String!, $first: Int = 15, $after: String = "") {
    viewer {
      id
      participantByEuid(euid: $euid) {
        id
        badges { unreadConversations }
        conversations(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            url
            updatedAt
            viewerHasUnreadMessages
            otherMembers { id profileUrl organisationName user { id firstName lastName jobPosition } }
            lastMessageV2 {
              __typename
              ... on Message { id body createdAt viewerIsAuthor authorV2 { id user { firstName lastName } } }
              ... on SystemMessageParticipantsAdded { id createdAt viewerIsAuthor }
              ... on UploadMessageFile { id createdAt viewerIsAuthor file { filename } }
              ... on UploadMessageImage { id createdAt viewerIsAuthor image { filename } }
            }
          }
        }
      }
    }
  }
`;

export const CONVERSATION = /* GraphQL */ `
  query Conversation($conversationId: UUID!, $first: Int = 50, $after: String = "") {
    conversation(id: $conversationId) {
      id
      url
      createdAt
      updatedAt
      viewerHasUnreadMessages
      otherMembers { id profileUrl organisationName user { id firstName lastName jobPosition } }
      messagesV2(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on Message { id body createdAt viewerIsAuthor authorV2 { id user { firstName lastName } } }
          ... on SystemMessageParticipantsAdded { id createdAt viewerIsAuthor }
          ... on UploadMessageFile { id createdAt viewerIsAuthor file { filename url } }
          ... on UploadMessageImage { id createdAt viewerIsAuthor image { filename url } }
        }
      }
    }
  }
`;

export const NOTIFICATION_COUNTERS = /* GraphQL */ `
  query ViewerNotificationCounters($euid: String!) {
    viewer {
      id
      participantByEuid(euid: $euid) {
        id
        notificationsCounter { unread unseen }
      }
    }
  }
`;

export const NOTIFICATIONS = /* GraphQL */ `
  query ViewerNotifications($euid: String!, $first: Int = 15, $after: String = "", $useClientCache: Boolean = false) {
    viewer {
      id
      participantByEuid(euid: $euid) {
        id
        notificationsCounter { unread unseen }
        notifications(first: $first, after: $after, useClientCache: $useClientCache) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            read
            seen
            createdAt
            content {
              __typename
              ... on MeetingRequestNotificationContent { meeting { id viewersViewMeetingUrl otherMember { participant { id organisationName user { firstName lastName } } } } }
              ... on MeetingAcceptNotificationContent { meeting { id status viewersViewMeetingUrl otherMember { participant { id organisationName user { firstName lastName } } } } }
              ... on MeetingCancelNotificationContent { meeting { id status viewersViewMeetingUrl otherMember { participant { id organisationName user { firstName lastName } } } } }
              ... on MeetingRescheduleProposedNotificationContent { meeting { id viewersViewMeetingUrl } }
              ... on MeetingRescheduleNotificationContent { meeting { id status viewersViewMeetingUrl } }
              ... on MeetingReminderNotificationContent { meeting { id status viewersViewMeetingUrl online joinUrl } }
              ... on MeetingFeedbackNotificationContent { meeting { id viewersViewMeetingUrl viewerShouldRate } }
              ... on MeetingUpdateNotificationContent { meeting { id viewersViewMeetingUrl } }
              ... on AnnouncementSentNotificationContent { announcement { id subject body sentAt } }
            }
          }
        }
      }
    }
  }
`;
