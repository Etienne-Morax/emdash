import MoraxCodeKit
import MoraxDesign
import SwiftUI

/// Picks the branch a new task starts from. Without a search it shows only the default
/// branch and the local ones; remote branches (thousands on a busy fork) appear only when
/// the user searches for one, so the list stays short and readable.
struct BaseBranchChooser: View {
  let options: [BaseBranch]
  let defaultBranch: String?
  @Binding var selection: String
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""

  private var remoteCount: Int { options.count(where: { $0.remote != nil }) }

  var body: some View {
    List {
      if query.trimmingCharacters(in: .whitespaces).isEmpty {
        Section {
          rows(NewTask.suggestedBranches(options, defaultBranch: defaultBranch))
        } footer: {
          if remoteCount > 0 {
            Text("\(remoteCount) more branches on the remote. Search to find one.")
          }
        }
      } else {
        let matches = NewTask.searchBranches(options, query: query, limit: Self.searchLimit)
        Section {
          if matches.isEmpty {
            Text("No branch matches “\(query)”.").foregroundStyle(.secondary)
          } else {
            rows(matches)
          }
        } footer: {
          if matches.count == Self.searchLimit {
            Text("Showing the first \(Self.searchLimit). Type more to narrow it down.")
          }
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(QuietBackground().ignoresSafeArea())
    .navigationTitle("Start from")
    .navigationBarTitleDisplayMode(.inline)
    .searchable(text: $query, prompt: "Search branches")
    .textInputAutocapitalization(.never)
    .autocorrectionDisabled()
  }

  private static let searchLimit = 50

  private func rows(_ branches: [BaseBranch]) -> some View {
    ForEach(branches) { branch in
      Button {
        selection = branch.id
        dismiss()
      } label: {
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(branch.branch).foregroundStyle(.primary)
            if branch.branch == defaultBranch {
              Text("Main branch").font(.caption).foregroundStyle(.secondary)
            } else if let remote = branch.remote {
              Text("On \(remote.name)").font(.caption).foregroundStyle(.secondary)
            }
          }
          Spacer()
          if branch.id == selection {
            Image(systemName: "checkmark").foregroundStyle(Palette.accent)
              .accessibilityLabel("Selected")
          }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
    }
  }
}
