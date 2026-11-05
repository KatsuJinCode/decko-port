export interface SetIncludes {
  readonly html?: readonly string[];
  readonly base?: readonly string[];
}

export const SET_INCLUDE_GRAPH: Readonly<Record<string, SetIncludes>> = {
  "Right::Bcc": {
    base: ["Abstract::EmailField"],
  },
  "Right::ByCreate": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::ByName": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::ByUpdate": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Cc": {
    base: ["Abstract::EmailField"],
  },
  "Right::Children": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Comment": {
    html: ["Abstract::Permission"],
  },
  "Right::Create": {
    html: ["Abstract::Permission"],
  },
  "Right::Created": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Creator": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Default": {
    html: ["Abstract::TemplatedNests"],
  },
  "Right::Delete": {
    html: ["Abstract::Permission"],
  },
  "Right::Edited": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Editors": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::EnabledRoles": {
    html: ["Abstract::AccountDropdown"],
  },
  "Right::Followers": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Right::From": {
    base: ["Abstract::EmailField"],
  },
  "Right::GroupRemote": {
    html: ["Abstract::ManifestGroup", "Abstract::ReadOnly"],
  },
  "Right::Help": {
    html: ["Abstract::TemplatedNests"],
  },
  "Right::HtmlMessage": {
    html: ["Abstract::TestContext"],
  },
  "Right::LastEdited": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::LinkedToBy": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::LinksTo": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::NestedBy": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Nests": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Read": {
    html: ["Abstract::Permission"],
  },
  "Right::ReferredToBy": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::RefersTo": {
    html: ["Abstract::VirtualSearch", "Abstract::CodeContent"],
  },
  "Right::Status": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Right::Structure": {
    html: ["Abstract::TemplatedNests"],
  },
  "Right::Subject": {
    html: ["Abstract::TestContext"],
  },
  "Right::TextMessage": {
    html: ["Abstract::TestContext"],
  },
  "Right::To": {
    base: ["Abstract::EmailField"],
  },
  "Right::Update": {
    html: ["Abstract::Permission"],
  },
  "Self::AccountLinks": {
    html: ["Abstract::AccountDropdown"],
  },
  "Self::Admin": {
    html: ["Abstract::TaskTable"],
  },
  "Self::Anonymous": {
    html: ["Abstract::AccountHolder"],
  },
  "Self::BootstrapCore": {
    html: ["Abstract::BootstrapCodeFile", "Abstract::Scss", "Abstract::Css", "Abstract::CodeFile", "Abstract::CodeContent"],
    base: ["Abstract::BootstrapCodeFile", "Abstract::Scss", "Abstract::Css"],
  },
  "Self::BootstrapFunctions": {
    html: ["Abstract::BootstrapCodeFile", "Abstract::Scss", "Abstract::Css", "Abstract::CodeFile", "Abstract::CodeContent"],
    base: ["Abstract::BootstrapCodeFile", "Abstract::Scss", "Abstract::Css"],
  },
  "Self::DeckoBot": {
    html: ["Abstract::AccountHolder"],
  },
  "Self::InputType::Right::ContentOptions": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Self::Mod": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Self::RecentSettings": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Self::StyleMods": {
    html: ["Abstract::AssetInputter"],
  },
  "Type::BootswatchSkin": {
    html: ["Abstract::SkinBox", "Abstract::Scss", "Abstract::Css", "Abstract::AssetInputter"],
    base: ["Abstract::Scss", "Abstract::Css"],
  },
  "Type::BootswatchSkin::HtmlViews": {
    html: ["Abstract::Media"],
  },
  "Type::Cardtype": {
    html: ["Abstract::CqlSearch", "Abstract::Search::Views", "Abstract::Search::SearchParams", "Abstract::Search", "Abstract::Paging::PagingViews"],
    base: ["Abstract::CqlSearch", "Abstract::Search::Views", "Abstract::Search::SearchParams", "Abstract::Search", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::CoffeeScript": {
    html: ["Abstract::CoffeeScript", "Abstract::Script", "Abstract::AssetInputter"],
    base: ["Abstract::CoffeeScript", "Abstract::Script"],
  },
  "Type::Css": {
    html: ["Abstract::AssetInputter", "Abstract::Css"],
    base: ["Abstract::Css"],
  },
  "Type::JavaScript": {
    html: ["Abstract::JavaScript", "Abstract::Script", "Abstract::AssetInputter"],
    base: ["Abstract::JavaScript", "Abstract::Script"],
  },
  "Type::LinkList": {
    html: ["Abstract::ReferenceList", "Abstract::Items::OptionsApi", "Abstract::Items"],
    base: ["Abstract::ReferenceList", "Abstract::Items::OptionsApi", "Abstract::Items"],
  },
  "Type::List": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::LocalScriptFolderGroup": {
    html: ["Abstract::ScriptGroup", "Abstract::AssetGroup", "Abstract::ReadOnly"],
  },
  "Type::LocalScriptManifestGroup": {
    html: ["Abstract::ScriptGroup", "Abstract::AssetGroup", "Abstract::ReadOnly", "Abstract::LocalManifestGroup", "Abstract::ManifestGroup"],
  },
  "Type::LocalStyleFolderGroup": {
    html: ["Abstract::StyleGroup", "Abstract::AssetGroup", "Abstract::ReadOnly"],
  },
  "Type::LocalStyleManifestGroup": {
    html: ["Abstract::StyleGroup", "Abstract::AssetGroup", "Abstract::ReadOnly", "Abstract::LocalManifestGroup", "Abstract::ManifestGroup"],
  },
  "Type::Mod": {
    html: ["Abstract::TaskTable", "Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::NestList": {
    html: ["Abstract::ReferenceList", "Abstract::Items::OptionsApi", "Abstract::Items"],
    base: ["Abstract::ReferenceList", "Abstract::Items::OptionsApi", "Abstract::Items"],
  },
  "Type::Pointer": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::Scss": {
    html: ["Abstract::AssetInputter", "Abstract::Scss", "Abstract::Css"],
    base: ["Abstract::Scss", "Abstract::Css"],
  },
  "Type::SearchType": {
    html: ["Abstract::SearchViews", "Abstract::CqlSearch", "Abstract::Search::Views", "Abstract::Search::SearchParams", "Abstract::Search", "Abstract::Paging::PagingViews"],
    base: ["Abstract::SearchViews", "Abstract::CqlSearch", "Abstract::Search::Views", "Abstract::Search::SearchParams", "Abstract::Search", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::Session": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::Set": {
    html: ["Abstract::SearchViews", "Abstract::CqlSearch", "Abstract::Search::Views", "Abstract::Search::SearchParams", "Abstract::Search", "Abstract::Paging::PagingViews"],
    base: ["Abstract::SearchViews", "Abstract::CqlSearch", "Abstract::Search::Views", "Abstract::Search::SearchParams", "Abstract::Search", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::Signup": {
    html: ["Abstract::AccountHolder"],
  },
  "Type::Skin": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::SkinBox", "Abstract::AssetInputter"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "Type::User": {
    html: ["Abstract::AccountHolder"],
  },
  "TypePlusRight::Mod::Script": {
    html: ["Abstract::ModAssets", "Abstract::ReadOnly", "Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::AssetInputter"],
    base: ["Abstract::ModAssets", "Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "TypePlusRight::Mod::Style": {
    html: ["Abstract::ModAssets", "Abstract::ReadOnly", "Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::AssetInputter"],
    base: ["Abstract::ModAssets", "Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
  "TypePlusRight::Set::Script": {
    base: ["Abstract::AssetOutputter"],
  },
  "TypePlusRight::Set::Style": {
    base: ["Abstract::AssetOutputter"],
  },
  "TypePlusRight::User::Follow": {
    html: ["Abstract::List::HtmlViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews"],
    base: ["Abstract::List::OtherViews", "Abstract::List", "Abstract::Items::OptionsApi", "Abstract::Items", "Abstract::Paging::PagingViews", "Abstract::Paging"],
  },
};
