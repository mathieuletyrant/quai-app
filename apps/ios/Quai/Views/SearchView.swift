import SwiftUI

typealias SearchResult = Components.Schemas.SearchResult
typealias TitleState = Components.Schemas.TitleState
typealias SeasonChoice = Components.Schemas.SeasonChoice

extension SearchResult: Identifiable {
    var id: String { "\(kind.rawValue):\(tmdbId)" }

    /// "Movie · 2021"
    var facts: String {
        var parts = [kind == .movie ? "Movie" : "Series"]
        if let year { parts.append(String(year)) }
        return parts.joined(separator: " · ")
    }

    /// The same title in Radarr or Sonarr, by its TMDB id, or a series' TVDB id (Sonarr may not
    /// know its TMDB id).
    func match(in library: Components.Schemas.Library?) -> LibraryItem? {
        library?.items.first { item in
            guard item.kind.rawValue == kind.rawValue else { return false }
            if item.tmdbId == tmdbId { return true }
            if let tvdbId, item.tvdbId == tvdbId { return true }
            return false
        }
    }
}

extension LibraryItem {
    /// A series of the library as Seerr knows it, to request more of its seasons. Nil for a movie,
    /// or a series whose TMDB id Sonarr doesn't know: Seerr's requests name it.
    var seerrSeries: SearchResult? {
        guard kind == .series, let tmdbId, tmdbId > 0 else { return nil }
        return SearchResult(kind: .series, tmdbId: tmdbId, tvdbId: tvdbId, title: title, year: year, posterUrl: posterUrl, overview: overview, state: .partial)
    }
}

/// The button a search result offers: request the title, or more seasons of a series.
enum RequestButton {
    case request
    case moreSeasons
}

extension TitleState {
    /// A series Seerr has some seasons of, in the library or only asked for, can still get the
    /// others: the season picker says which. A movie asked for, or a title in the library, has none.
    func requestButton(for kind: Components.Schemas.TitleKind) -> RequestButton? {
        switch self {
        case .requestable: .request
        case .partial: .moreSeasons
        case .requested: kind == .series ? .moreSeasons : nil
        case .available: nil
        }
    }
}

/// The Search tab: a title typed or dictated, Seerr's results, and the one to request. Opened by
/// the Lock Screen widget (keyboard up) and the control (already listening).
struct SearchView: View {
    @Environment(Connection.self) private var connection
    @Binding var link: SearchLink?
    @State private var query: String
    @State private var results: Components.Schemas.SearchResults?
    @State private var error: String?
    /// What a request just changed, until the next search reads it from Seerr.
    @State private var states: [String: TitleState] = [:]
    @State private var working: String?
    @State private var choosingSeasons: SearchResult?
    /// A result tapped that Radarr or Sonarr has: its library page.
    @State private var opened: LibraryItem?
    /// A result tapped that isn't in the library yet: what Seerr says of it.
    @State private var previewing: SearchResult?
    /// Requested from that preview: asked once its sheet is gone, so the season picker can open.
    @State private var requestAfterPreview: SearchResult?
    @State private var notice: String?
    @State private var failure: String?
    @State private var dictation = Dictation()
    @FocusState private var fieldFocused: Bool

    init(link: Binding<SearchLink?>, query: String = "") {
        _link = link
        _query = State(initialValue: query)
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.tileSpacing) {
                    if dictation.isListening {
                        ListeningCard(transcript: dictation.transcript) { dictation.stop() }
                    }
                    content
                }
                // Full width even when empty: otherwise the column collapses to its padding and
                // the loader grows out of it, a narrow vertical band, as the keyboard animates.
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 8)
                .padding(.bottom, Metrics.tabBarClearance)
            }
            .scrollDismissesKeyboard(.immediately)
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        if dictation.isListening { dictation.stop() } else { listen() }
                    } label: {
                        Image(systemName: dictation.isListening ? "stop.fill" : "mic.fill")
                    }
                    .accessibilityLabel(dictation.isListening ? "Stop dictation" : "Dictate a title")
                }
            }
        }
        .searchable(text: $query, prompt: "Movies and series")
        .searchFocused($fieldFocused)
        .task(id: trimmed) { await search(trimmed) }
        .onChange(of: dictation.transcript) { _, heard in
            if dictation.isListening, !heard.isEmpty { query = heard }
        }
        .onChange(of: link, initial: true) { _, opened in
            guard let opened else { return }
            link = nil
            if opened.listen { listen() } else { fieldFocused = true }
        }
        .onAppear {
            dictation.finished = { text in query = text }
        }
        .onDisappear { dictation.cancel() }
        .task {
            // To open a result that's already there on its library page.
            if connection.library == nil { await connection.loadLibrary() }
        }
        .sheet(item: $opened) { item in
            TitleDetailView(item: item)
        }
        .sheet(item: $previewing, onDismiss: {
            guard let result = requestAfterPreview else { return }
            requestAfterPreview = nil
            request(result)
        }, content: { result in
            SearchResultDetail(result: result, state: states[result.id] ?? result.state) {
                requestAfterPreview = result
                previewing = nil
            }
        })
        .sheet(item: $choosingSeasons) { series in
            SeasonPicker(result: series) { seasons in send(series, seasons: seasons) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .alert("Couldn't request it", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    @ViewBuilder private var content: some View {
        if let notice {
            MessageTile(title: "Requested", message: notice, systemImage: "checkmark.circle.fill", color: Palette.ok)
        }
        if case .denied = dictation.state {
            MessageTile(
                title: "Dictation is off",
                message: "Allow the microphone and speech recognition for Quai in the iPhone's Settings, or type the title.",
                systemImage: "mic.slash.fill",
                color: Palette.toFix
            )
        } else if case let .failed(message) = dictation.state {
            MessageTile(title: "Couldn't listen", message: message, systemImage: "mic.slash.fill", color: Palette.toFix)
        }
        if let error {
            MessageTile(title: "Can't search", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
        }
        if trimmed.isEmpty {
            if !dictation.isListening { SearchHint(listen: listen) }
        } else if let results {
            switch results.status {
            case .notConfigured:
                MessageTile(title: "No Seerr", message: "Quai Home has no Seerr: add it in the console's Services page.", systemImage: "magnifyingglass", color: Palette.toFix)
            case .outdated:
                MessageTile(title: "Update Quai Home", message: "Your Quai Home is too old to search Seerr from the app.", systemImage: "arrow.down.circle.fill", color: Palette.toFix)
            case .unavailable:
                MessageTile(title: "Seerr didn't answer", message: "Try again in a moment.", systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
            case .ok:
                if results.items.isEmpty {
                    MessageTile(title: "Nothing found", message: "Seerr finds nothing for “\(trimmed)”.", systemImage: "magnifyingglass")
                }
                ForEach(results.items) { result in
                    SearchResultRow(result: result, state: states[result.id] ?? result.state, busy: working == result.id) {
                        request(result)
                    }
                    .contentShape(RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                    .onTapGesture { open(result) }
                    .accessibilityAddTraits(.isButton)
                }
            }
        } else if error == nil {
            // From the first letter, while the search waits for a pause and while Seerr answers.
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        }
    }

    private func listen() {
        fieldFocused = false
        notice = nil
        Task { await dictation.start() }
    }

    private func search(_ text: String) async {
        guard !text.isEmpty else {
            results = nil
            error = nil
            return
        }
        // Typing: wait for a pause before asking Seerr. The last results stay until new ones come.
        error = nil
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        do {
            let found = try await connection.search(text)
            guard !Task.isCancelled else { return }
            results = found
            states = [:]
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.message(replacing: self.error)
        }
    }

    /// Its library page when Radarr or Sonarr has it, Seerr's details otherwise. A title Seerr says
    /// is requested or there may have reached the library since it was read: read it again first.
    private func open(_ result: SearchResult) {
        if let item = result.match(in: connection.library) {
            opened = item
            return
        }
        guard (states[result.id] ?? result.state) != .requestable else {
            previewing = result
            return
        }
        Task {
            await connection.loadLibrary()
            if let item = result.match(in: connection.library) { opened = item } else { previewing = result }
        }
    }

    /// A movie is requested at once; a series asks which seasons first.
    private func request(_ result: SearchResult) {
        if result.kind == .series {
            choosingSeasons = result
        } else {
            send(result, seasons: [])
        }
    }

    private func send(_ result: SearchResult, seasons: [Int]) {
        working = result.id
        notice = nil
        Task {
            do {
                let created = try await connection.request(result, seasons: seasons)
                states[result.id] = .requested
                notice = created.status == .approved
                    ? "\(result.title) is on its way."
                    : "\(result.title) waits for approval in Seerr."
                await connection.loadLibrary()
            } catch {
                failure = error.message(replacing: failure)
            }
            working = nil
        }
    }
}

/// Before anything is typed: what the search does, and the microphone.
private struct SearchHint: View {
    let listen: () -> Void

    var body: some View {
        Tile {
            TileLabel(title: "Search Seerr", systemImage: "magnifyingglass", color: Palette.requests)
            Text("Type or say a title: Seerr finds it, and you pick the one to request.")
                .font(QuaiFont.subheadline)
                .foregroundStyle(Palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: listen) {
                Label("Say a title", systemImage: "mic.fill")
            }
            .buttonStyle(PillButtonStyle())
        }
    }
}

/// A title Seerr found that isn't in the library: its poster, story and the Request button.
struct SearchResultDetail: View {
    @Environment(\.dismiss) private var dismiss
    let result: SearchResult
    let state: TitleState
    let request: () -> Void

    private var stateLine: (text: String, color: Color) {
        switch state {
        case .available: ("In library", Palette.ok)
        case .requested: ("Requested", Palette.requests)
        case .partial: ("Some seasons in library", Palette.requests)
        case .requestable: ("Not in library", Palette.secondaryText)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Spacer()
                    GlassIconButton(systemImage: "xmark", label: "Close") { dismiss() }
                }
                HStack(alignment: .bottom, spacing: 16) {
                    Poster(url: PosterSize.large.url(result.posterUrl), title: result.title, cornerRadius: 14)
                        .frame(width: 104)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(result.title)
                            .font(QuaiFont.title)
                            .tracking(-0.3)
                            .foregroundStyle(Palette.primaryText)
                            .lineLimit(3)
                        Text(result.facts)
                            .font(.system(size: 14))
                            .foregroundStyle(Palette.secondaryText)
                        Text(stateLine.text)
                            .font(QuaiFont.eyebrow)
                            .foregroundStyle(stateLine.color)
                    }
                    .padding(.bottom, 4)
                }
                if let button = state.requestButton(for: result.kind) {
                    Button(button == .moreSeasons ? "Request more seasons" : "Request", action: request)
                        .buttonStyle(PillButtonStyle())
                }
                if let overview = result.overview {
                    Card(spacing: 8) {
                        Text("STORY").font(QuaiFont.eyebrow).foregroundStyle(Palette.secondaryText)
                        Text(overview)
                            .font(QuaiFont.subheadline)
                            .foregroundStyle(Palette.primaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(Metrics.gutter)
        }
        .scrollIndicators(.hidden)
        .background(Palette.background.ignoresSafeArea())
    }
}

/// While the microphone is on: what it heard so far, and a button to stop.
private struct ListeningCard: View {
    let transcript: String
    let stop: () -> Void

    var body: some View {
        Card(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "waveform")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Palette.requests)
                    .symbolEffect(.variableColor.iterative, options: .repeating)
                Text("Listening…")
                    .font(QuaiFont.headline)
                    .foregroundStyle(Palette.primaryText)
                Spacer()
                Button("Done", action: stop).buttonStyle(FixButtonStyle(prominent: false))
            }
            Text(transcript.isEmpty ? "Say a movie or a series." : transcript)
                .font(QuaiFont.body)
                .foregroundStyle(transcript.isEmpty ? Palette.secondaryText : Palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// One title Seerr found: its poster, what it is, and where it stands or the Request button.
private struct SearchResultRow: View {
    let result: SearchResult
    let state: TitleState
    let busy: Bool
    let request: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            PosterThumbnail(url: PosterSize.small.url(result.posterUrl), width: 52, cornerRadius: 10) {
                SymbolSquare(systemImage: result.kind == .movie ? "film" : "tv", color: Palette.requests, size: 52)
            }
            .frame(width: 52, height: 78)
            VStack(alignment: .leading, spacing: 3) {
                Text(result.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(result.facts)
                    .font(QuaiFont.caption)
                    .foregroundStyle(Palette.secondaryText)
                if let overview = result.overview {
                    Text(overview)
                        .font(QuaiFont.caption)
                        .foregroundStyle(Palette.tertiaryText)
                        .lineLimit(2)
                }
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 8)
            trailing
        }
        .padding(12)
        .background(Palette.tile, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }

    @ViewBuilder private var trailing: some View {
        if busy {
            ProgressView()
        } else {
            switch state.requestButton(for: result.kind) {
            case .request:
                Button("Request", action: request).buttonStyle(FixButtonStyle())
            case .moreSeasons:
                Button("More", action: request).buttonStyle(FixButtonStyle(prominent: false))
                    .accessibilityLabel("Request more seasons")
            case nil:
                if state == .available {
                    Badge(text: "In library", fill: Palette.ok.opacity(0.18), color: Palette.ok)
                } else {
                    Badge(text: "Requested", fill: Palette.requests.opacity(0.18), color: Palette.requests)
                }
            }
        }
    }
}

extension SeasonChoice {
    var label: String { "Season \(number)" }

    var stateLabel: String {
        switch state {
        case .available: "In library"
        case .partial: "Partly in library"
        case .requested: "Requested"
        case .requestable: episodes.map { $0 == 1 ? "1 episode" : "\($0) episodes" } ?? ""
        }
    }
}

/// A series' seasons to request: the first one free to request is checked, "All" takes them all.
struct SeasonPicker: View {
    @Environment(Connection.self) private var connection
    @Environment(\.dismiss) private var dismiss
    let result: SearchResult
    let request: ([Int]) -> Void
    @State private var seasons: [SeasonChoice]?
    @State private var chosen: Set<Int> = []
    @State private var error: String?

    init(result: SearchResult, seasons: [SeasonChoice]? = nil, request: @escaping ([Int]) -> Void) {
        self.result = result
        self.request = request
        _seasons = State(initialValue: seasons)
        _chosen = State(initialValue: Self.firstChoice(seasons ?? []))
    }

    private var requestable: [Int] { (seasons ?? []).filter { $0.state == .requestable }.map(\.number) }

    private static func firstChoice(_ seasons: [SeasonChoice]) -> Set<Int> {
        seasons.first { $0.state == .requestable }.map { [$0.number] } ?? []
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error {
                        MessageTile(title: "Can't read the seasons", message: error, systemImage: "exclamationmark.triangle.fill", color: Palette.toFix)
                    }
                    if let seasons {
                        if requestable.isEmpty {
                            MessageTile(title: "Nothing left to request", message: "Every season is in the library or already asked for.", systemImage: "checkmark.seal.fill", color: Palette.ok)
                        }
                        GroupedSection {
                            ForEach(seasons, id: \.number) { season in
                                SeasonRow(season: season, isOn: Binding(
                                    get: { chosen.contains(season.number) },
                                    set: { on in if on { chosen.insert(season.number) } else { chosen.remove(season.number) } }
                                ))
                            }
                        }
                    } else if error == nil {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                    }
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 8)
            }
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle(result.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(chosen.count == requestable.count && !requestable.isEmpty ? "Only one" : "All") {
                        if chosen.count == requestable.count {
                            chosen = Self.firstChoice(seasons ?? [])
                        } else {
                            chosen = Set(requestable)
                        }
                    }
                    .disabled(requestable.count < 2)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(chosen.count == 1 ? "Request 1 season" : "Request \(chosen.count) seasons") {
                    request(chosen.sorted())
                    dismiss()
                }
                .buttonStyle(PillButtonStyle())
                .disabled(chosen.isEmpty)
                .opacity(chosen.isEmpty ? 0.5 : 1)
                .padding(.horizontal, Metrics.gutter)
                .padding(.bottom, 8)
            }
        }
        .task {
            guard seasons == nil else { return }
            do {
                let read = try await connection.seasons(of: result)
                seasons = read
                chosen = Self.firstChoice(read)
            } catch {
                self.error = error.message(replacing: self.error)
            }
        }
    }
}

private struct SeasonRow: View {
    let season: SeasonChoice
    @Binding var isOn: Bool

    var body: some View {
        if season.state == .requestable {
            Toggle(isOn: $isOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(season.label).font(QuaiFont.body).foregroundStyle(Palette.primaryText)
                    if !season.stateLabel.isEmpty {
                        Text(season.stateLabel).font(QuaiFont.caption).foregroundStyle(Palette.secondaryText)
                    }
                }
            }
            .tint(.quaiAccent)
            .padding(.horizontal, 14)
            .frame(minHeight: 56)
        } else {
            ListRow(title: season.label, value: season.stateLabel)
        }
    }
}
