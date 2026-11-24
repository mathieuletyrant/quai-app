import AVFoundation
import Observation
import Speech

/// The search's dictation: listens to the microphone and writes what it hears, on the iPhone when
/// it can (nothing but the text leaves it). Stops on its own after a short silence.
@MainActor @Observable
final class Dictation {
    enum State: Equatable {
        case idle
        case listening
        /// The microphone or speech recognition was refused: only the iPhone's Settings can allow it.
        case denied
        case failed(String)
    }

    private(set) var state = State.idle
    /// What it heard so far.
    private(set) var transcript = ""

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var silence: Task<Void, Never>?
    /// Called once with the whole text, when it stops on its own.
    @ObservationIgnored var finished: ((String) -> Void)?

    /// After the last word heard, how long it waits before taking the text.
    private static let pause = Duration.milliseconds(1500)
    /// Before any word, how long it waits.
    private static let firstWord = Duration.seconds(8)

    var isListening: Bool { state == .listening }

    func start() async {
        guard state != .listening else { return }
        transcript = ""
        guard await AVAudioApplication.requestRecordPermission(), await Self.speechAuthorized() else {
            state = .denied
            return
        }
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            state = .failed("Dictation isn't available right now.")
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.taskHint = .search
            if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

            let engine = AVAudioEngine()
            Self.tap(engine.inputNode, into: request)
            engine.prepare()
            try engine.start()

            self.engine = engine
            self.request = request
            task = Self.recognize(request, with: recognizer) { [weak self] text, isFinal, failed in
                Task { @MainActor in self?.heard(text, isFinal: isFinal, failed: failed) }
            }
            state = .listening
            waitForSilence(Self.firstWord)
        } catch {
            tearDown()
            state = .failed("The microphone didn't start.")
        }
    }

    /// Stops listening and keeps what was heard.
    func stop() {
        guard state == .listening else { return }
        tearDown()
        state = .idle
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { finished?(text) }
    }

    /// Stops listening and drops what was heard.
    func cancel() {
        tearDown()
        transcript = ""
        state = .idle
    }

    private func heard(_ text: String?, isFinal: Bool, failed: Bool) {
        guard state == .listening else { return }
        if let text, !text.isEmpty {
            transcript = text
            waitForSilence(Self.pause)
        }
        if isFinal || failed { stop() }
    }

    private func waitForSilence(_ duration: Duration) {
        silence?.cancel()
        silence = Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled else { return }
            self?.stop()
        }
    }

    private func tearDown() {
        silence?.cancel()
        silence = nil
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        engine = nil
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // The audio tap and the recognizer call back on their own threads: their closures are made
    // outside the main actor, or Swift 6 would check they run on it, and stop the app.

    nonisolated private static func tap(_ input: AVAudioInputNode, into request: SFSpeechAudioBufferRecognitionRequest) {
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
    }

    nonisolated private static func recognize(
        _ request: SFSpeechAudioBufferRecognitionRequest,
        with recognizer: SFSpeechRecognizer,
        _ update: @escaping @Sendable (String?, Bool, Bool) -> Void
    ) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { result, error in
            update(result?.bestTranscription.formattedString, result?.isFinal ?? false, error != nil)
        }
    }

    nonisolated private static func speechAuthorized() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }
}
